import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDisposablePostgres, type DisposablePostgres } from "../../../database/src/testing/postgres.js";
import {
  LibraryRebuildConflictError,
  LibraryRebuildJobService,
  LibraryRebuildPositionOverflowError,
  loadApprovedIndexingBaseline,
  seedIndexingBaseline,
} from "./rebuild-job.js";

describe("library rebuild parent job", () => {
  let postgres: DisposablePostgres;
  let adminId: string;
  let service: LibraryRebuildJobService;

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    adminId = (await postgres.db.insertInto("users").values({
      display_name: "Admin",
      role: "admin",
      status: "active",
    }).returning("id").executeTakeFirstOrThrow()).id;
    service = new LibraryRebuildJobService(postgres.db);
  });

  afterEach(async () => postgres.destroy());

  async function book(title: string, updatedAt: string) {
    return postgres.db.insertInto("books").values({
      title,
      created_by: adminId,
      status: "active",
      updated_at: updatedAt,
    }).returning("id").executeTakeFirstOrThrow();
  }

  it("seeds the approved baseline idempotently without legacy configuration", async () => {
    const baseline = await loadApprovedIndexingBaseline();
    const first = await seedIndexingBaseline(postgres.db, baseline);
    const second = await seedIndexingBaseline(postgres.db, baseline);
    expect(second).toEqual(first);
    expect(await postgres.db.selectFrom("prompt_versions")
      .select(["target", "version", "content_hash"]).orderBy("target").execute()).toEqual([
      { target: "l1-index", version: baseline.l1.promptVersion, content_hash: baseline.l1.promptSha256 },
      { target: "l2-index", version: baseline.l2.promptVersion, content_hash: baseline.l2.promptSha256 },
    ]);
    expect(await postgres.db.selectFrom("workflow_versions").select("target").execute())
      .toHaveLength(2);
  });

  it("creates one globally active batch with one book step in recent-update order", async () => {
    const oldest = await book("Old", "2026-07-20T00:00:00.000Z");
    const newest = await book("New", "2026-07-22T00:00:00.000Z");
    const middle = await book("Middle", "2026-07-21T00:00:00.000Z");

    const created = await service.create({ requestedBy: adminId, requestId: "batch-1" });
    const replay = await service.create({ requestedBy: adminId, requestId: "batch-2" });
    const steps = await postgres.db.selectFrom("job_steps")
      .select(["id", "position", "kind", "output_ref", "attempt_count"])
      .where("job_id", "=", created.id).orderBy("position").execute();

    expect(replay.id).toBe(created.id);
    expect(created).toMatchObject({
      type: "library-rebuild",
      scope: { target: "all" },
      progress: { total: 3 },
    });
    expect(steps.map((step) => step.output_ref)).toEqual([
      { bookId: newest.id, stage: "waiting" },
      { bookId: middle.id, stage: "waiting" },
      { bookId: oldest.id, stage: "waiting" },
    ]);
    expect(steps.every((step) => step.kind === "library-rebuild-book"
      && step.attempt_count === 0)).toBe(true);
    expect(await postgres.db.selectFrom("jobs").select("id")
      .where("concurrency_key", "=", "library-rebuild:all").execute()).toHaveLength(1);
  });

  it("atomically reorders only the complete untouched set and writes one audit", async () => {
    await book("A", "2026-07-22T00:00:00.000Z");
    await book("B", "2026-07-21T00:00:00.000Z");
    await book("C", "2026-07-20T00:00:00.000Z");
    const job = await service.create({ requestedBy: adminId, requestId: "batch" });
    const original = await service.get(job.id);
    const reversed = original!.steps.map((step) => step.id).reverse();

    const reordered = await service.reorder({
      jobId: job.id,
      orderedStepIds: reversed,
      actorUserId: adminId,
    });
    expect(reordered.steps.map((step) => step.id)).toEqual(reversed);
    expect(reordered.steps.map((step) => step.position)).toEqual([0, 1, 2]);
    expect(await postgres.db.selectFrom("audit_logs").selectAll()
      .where("action", "=", "library_rebuild.reorder").execute()).toHaveLength(1);

    await expect(service.reorder({
      jobId: job.id,
      orderedStepIds: reversed.slice(1),
      actorUserId: adminId,
    })).rejects.toBeInstanceOf(LibraryRebuildConflictError);
    expect((await service.get(job.id))!.steps.map((step) => step.id)).toEqual(reversed);
  });

  it("rejects started steps and positive temporary range overflow with zero effects", async () => {
    await book("A", "2026-07-22T00:00:00.000Z");
    await book("B", "2026-07-21T00:00:00.000Z");
    const firstJob = await service.create({ requestedBy: adminId, requestId: "batch" });
    const initial = await service.get(firstJob.id);
    await postgres.db.updateTable("job_steps").set({ attempt_count: 1 })
      .where("id", "=", initial!.steps[0]!.id).execute();
    await expect(service.reorder({
      jobId: firstJob.id,
      orderedStepIds: initial!.steps.map((step) => step.id).reverse(),
      actorUserId: adminId,
    })).rejects.toBeInstanceOf(LibraryRebuildConflictError);
    expect(await postgres.db.selectFrom("audit_logs").select("id").execute()).toEqual([]);

    await postgres.db.updateTable("job_steps").set({ attempt_count: 0 })
      .where("job_id", "=", firstJob.id).execute();
    await postgres.db.updateTable("job_steps").set({
      position: sql<number>`2147483647 - case when position = 0 then 1 else 0 end`,
    }).where("job_id", "=", firstJob.id).execute();
    const overflowOrder = (await service.get(firstJob.id))!.steps.map((step) => step.id).reverse();
    await expect(service.reorder({
      jobId: firstJob.id,
      orderedStepIds: overflowOrder,
      actorUserId: adminId,
    })).rejects.toBeInstanceOf(LibraryRebuildPositionOverflowError);
    expect(await postgres.db.selectFrom("audit_logs").select("id").execute()).toEqual([]);
  });
});
