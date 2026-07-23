import { createHash } from "node:crypto";
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

  it("binds L1 and L2 children to the approved baseline when newer configuration exists", async () => {
    const driftContent = "newer unapproved prompt";
    await postgres.db.insertInto("prompt_versions").values({
      target: "l1-index",
      version: "unapproved-l1",
      content: driftContent,
      content_hash: createHash("sha256").update(driftContent).digest("hex"),
    }).execute();
    await postgres.db.insertInto("workflow_versions").values([
      { target: "l1-index", contract_version: "unapproved-l1", dsl_hash: "unapproved-l1-dsl" },
      { target: "l2-index", contract_version: "unapproved-l2", dsl_hash: "unapproved-l2-dsl" },
    ]).execute();

    await runParent();
    let parent = await new LibraryRebuildJobService(postgres.db).get(parentJobId);
    const l1JobId = parent!.steps[0]!.ref.l1JobId!;
    const l1Snapshot = (await postgres.db.selectFrom("jobs").select("config_snapshot")
      .where("id", "=", l1JobId).executeTakeFirstOrThrow()).config_snapshot;
    expect(l1Snapshot).toMatchObject({
      prompt: { version: "phase5-l1-v1" },
      workflow: {
        contractVersion: "l1-route-v1",
        dslHash: "ebd3d3b403e9dd10bc6f5f0a2a16e94c7cfe94dc5c83ed766b34ba9f00190bf9",
      },
    });

    await runChild(l1JobId, "l1-index");
    await runParent();
    parent = await new LibraryRebuildJobService(postgres.db).get(parentJobId);
    const l2Snapshot = (await postgres.db.selectFrom("jobs").select("config_snapshot")
      .where("id", "=", parent!.steps[0]!.ref.l2JobId!).executeTakeFirstOrThrow()).config_snapshot;
    expect(l2Snapshot).toMatchObject({
      prompt: { version: "phase5-l2-v1" },
      workflow: {
        contractVersion: "l2-fact-v1",
        dslHash: "b8003c60302c80d017eb00eac16ed18b0d4dba6df6073c6eb1735a2139ae4894",
      },
    });
  });

  it("leaves no base group or L2 child when authority is reclaimed after the entry check", async () => {
    await runParent();
    const l1JobId = (await new LibraryRebuildJobService(postgres.db)
      .get(parentJobId))!.steps[0]!.ref.l1JobId!;
    await runChild(l1JobId, "l1-index");
    const stale = (await parentLeases().claimNext(parentJobId, "stale-after-check", new Date()))!;
    const executor = new RebuildExecutor({ database: postgres.db, deferDelayMs: 0 });
    const internal = executor as unknown as {
      isCurrent(claim: typeof stale): Promise<boolean>;
    };
    const originalIsCurrent = internal.isCurrent.bind(executor);
    let releaseEntry!: () => void;
    let notifyChecked!: () => void;
    const checked = new Promise<void>((resolve) => { notifyChecked = resolve; });
    const entryGate = new Promise<void>((resolve) => { releaseEntry = resolve; });
    internal.isCurrent = async (claim) => {
      const current = await originalIsCurrent(claim);
      notifyChecked();
      await entryGate;
      return current;
    };

    const staleExecution = executor.execute(stale);
    await checked;
    await postgres.db.updateTable("job_steps").set({
      lease_expires_at: sql<Date>`clock_timestamp() - interval '1 second'`,
    }).where("id", "=", stale.stepId).execute();
    const current = await parentLeases().claimNext(parentJobId, "current-worker", new Date());
    releaseEntry();

    await expect(staleExecution).resolves.toEqual({ disposition: "terminal-noop" });
    expect(current).toMatchObject({ stepId: stale.stepId, attemptNo: stale.attemptNo + 1 });
    expect(await postgres.db.selectFrom("index_groups").select("id")
      .where("book_id", "=", bookId).execute()).toEqual([]);
    expect(await postgres.db.selectFrom("jobs").select("id")
      .where("type", "=", "l2-index").execute()).toEqual([]);
  });
});
