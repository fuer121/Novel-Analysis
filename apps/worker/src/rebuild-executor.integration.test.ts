import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "kysely";

import { createContentCipher, createLibraryRepository } from "@novel-analysis/database";
import { FakeDifyAdapter } from "@novel-analysis/dify";
import {
  LibraryRebuildJobService,
  PostgresStepLeaseService,
} from "@novel-analysis/jobs";
import { createDisposablePostgres, type DisposablePostgres } from "../../../packages/database/src/testing/postgres.js";

import { LibraryImportExecutor } from "./library-executor.js";
import { RebuildExecutor } from "./rebuild-executor.js";

describe("recoverable library rebuild executor", () => {
  let postgres: DisposablePostgres;
  let adminId: string;
  let bookId: string;
  let parentJobId: string;
  const cipher = createContentCipher({
    activeKeyVersion: "test",
    keys: { test: Buffer.alloc(32, 8) },
  });

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    adminId = (await postgres.db.insertInto("users").values({
      display_name: "Admin",
      role: "admin",
      status: "active",
    }).returning("id").executeTakeFirstOrThrow()).id;
    const library = createLibraryRepository(postgres.db, cipher);
    bookId = (await library.createBook({ title: "Recovery Book", createdBy: adminId })).id;
    await library.insertChapter({
      bookId,
      chapterIndex: 1,
      title: "One",
      plaintext: "controlled chapter",
      contentHmac: "controlled-hmac",
      sourceVersion: "source-v1",
    });
    parentJobId = (await new LibraryRebuildJobService(postgres.db)
      .create({ requestedBy: adminId, requestId: "recovery" })).id;
  });

  afterEach(async () => postgres.destroy());

  const parentLeases = () => new PostgresStepLeaseService({
    database: postgres.db,
    leaseDurationMs: 60_000,
  });

  async function runParent() {
    const claim = await parentLeases().claimNext(parentJobId, crypto.randomUUID(), new Date());
    if (!claim) throw new Error("parent claim missing");
    return new RebuildExecutor({ database: postgres.db, deferDelayMs: 0 }).execute(claim);
  }

  async function runChild(jobId: string, target: "l1-index" | "l2-index") {
    const leases = new PostgresStepLeaseService({ database: postgres.db, leaseDurationMs: 60_000 });
    const claim = await leases.claimNext(jobId, `${target}-worker`, new Date());
    if (!claim) throw new Error(`${target} claim missing`);
    const script = target === "l1-index"
      ? { target, invocationKey: claim.stepId, output: {
          route_schema_version: "l1-route-v1",
          route_entities: [],
          route_keywords: ["controlled"],
          signals: [],
          category_scores: {},
        } }
      : { target, invocationKey: claim.stepId, output: { chapter_index: 1, chapter_title: "One", facts: [] } };
    const executor = new LibraryImportExecutor({
      database: postgres.db,
      adapter: new FakeDifyAdapter([script]),
      cipher,
      hmacKey: Buffer.from("controlled-hmac-key"),
    });
    await expect(executor.execute(claim)).resolves.toEqual({ disposition: "completed" });
  }

  it("resumes waiting-l1-l2-verify from stored child ids without duplicate active children", async () => {
    await expect(runParent()).resolves.toEqual({ disposition: "deferred" });
    let parent = await new LibraryRebuildJobService(postgres.db).get(parentJobId);
    const l1JobId = parent!.steps[0]!.ref.l1JobId!;
    expect(parent!.steps[0]!.ref.stage).toBe("l1");

    await expect(runParent()).resolves.toEqual({ disposition: "deferred" });
    parent = await new LibraryRebuildJobService(postgres.db).get(parentJobId);
    expect(parent!.steps[0]!.ref.l1JobId).toBe(l1JobId);
    expect(await postgres.db.selectFrom("jobs").select("id")
      .where("type", "=", "l1-index").where("status", "in", ["queued", "running"])
      .execute()).toHaveLength(1);

    await runChild(l1JobId, "l1-index");
    await expect(runParent()).resolves.toEqual({ disposition: "deferred" });
    parent = await new LibraryRebuildJobService(postgres.db).get(parentJobId);
    const l2JobId = parent!.steps[0]!.ref.l2JobId!;
    expect(parent!.steps[0]!.ref).toMatchObject({
      bookId,
      stage: "l2",
      l1JobId,
      l2JobId,
      baseGroupId: expect.any(String),
    });

    await expect(runParent()).resolves.toEqual({ disposition: "deferred" });
    expect((await new LibraryRebuildJobService(postgres.db).get(parentJobId))!
      .steps[0]!.ref.l2JobId).toBe(l2JobId);
    expect(await postgres.db.selectFrom("jobs").select("id")
      .where("type", "=", "l2-index").where("status", "in", ["queued", "running"])
      .execute()).toHaveLength(1);

    await runChild(l2JobId, "l2-index");
    await expect(runParent()).resolves.toEqual({ disposition: "deferred" });
    expect((await new LibraryRebuildJobService(postgres.db).get(parentJobId))!
      .steps[0]!.ref.stage).toBe("verify");
    await expect(runParent()).resolves.toEqual({ disposition: "completed" });
    expect((await new LibraryRebuildJobService(postgres.db).get(parentJobId))!.job.status)
      .toBe("completed");
  });

  it("rejects an already expired attempt before creating a child job", async () => {
    const stale = (await parentLeases().claimNext(parentJobId, "stale-worker", new Date()))!;
    await postgres.db.updateTable("job_steps").set({
      lease_expires_at: sql<Date>`clock_timestamp() - interval '1 second'`,
    }).where("id", "=", stale.stepId).execute();
    await expect(new RebuildExecutor({ database: postgres.db, deferDelayMs: 0 })
      .execute(stale)).resolves.toEqual({ disposition: "terminal-noop" });
    expect(await postgres.db.selectFrom("jobs").select("id")
      .where("type", "=", "l1-index").execute()).toEqual([]);
    expect((await postgres.db.selectFrom("job_steps").select("status")
      .where("id", "=", stale.stepId).executeTakeFirstOrThrow()).status).toBe("running");
  });
});
