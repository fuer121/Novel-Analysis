import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDisposablePostgres, type DisposablePostgres } from "../../database/src/testing/postgres.js";
import { LibraryRebuildJobService } from "./library/rebuild-job.js";
import { PostgresStepLeaseService } from "./step-leases.js";

describe("deferred step transition", () => {
  let postgres: DisposablePostgres;
  let jobId: string;
  let leases: PostgresStepLeaseService;

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    const adminId = (await postgres.db.insertInto("users").values({
      display_name: "Admin",
      role: "admin",
      status: "active",
    }).returning("id").executeTakeFirstOrThrow()).id;
    await postgres.db.insertInto("books").values({
      title: "Book",
      created_by: adminId,
      status: "active",
    }).execute();
    jobId = (await new LibraryRebuildJobService(postgres.db)
      .create({ requestedBy: adminId, requestId: "defer" })).id;
    leases = new PostgresStepLeaseService({ database: postgres.db, leaseDurationMs: 60_000 });
  });

  afterEach(async () => postgres.destroy());

  it("atomically completes the attempt, requeues the step, stores its ref and deduplicates its wake", async () => {
    const claim = (await leases.claimNext(jobId, "worker-a", new Date()))!;
    const ref = { bookId: (await postgres.db.selectFrom("books").select("id").executeTakeFirstOrThrow()).id, stage: "l1" as const, l1JobId: crypto.randomUUID() };
    await expect(leases.deferStep(claim, ref, 250)).resolves.toEqual({ disposition: "deferred" });
    const step = await postgres.db.selectFrom("job_steps").selectAll()
      .where("id", "=", claim.stepId).executeTakeFirstOrThrow();
    const attempt = await postgres.db.selectFrom("job_attempts").selectAll()
      .where("id", "=", claim.attemptId).executeTakeFirstOrThrow();
    expect(step).toMatchObject({
      status: "queued",
      output_ref: ref,
      lease_owner: null,
      lease_expires_at: null,
    });
    expect(attempt).toMatchObject({ status: "completed", finished_at: expect.any(Date) });
    const wakes = await postgres.db.selectFrom("job_outbox").select(["payload", "available_at"])
      .where("job_id", "=", jobId).execute();
    expect(wakes.filter((wake) => wake.payload.dedupeKey === `defer:${claim.stepId}:${claim.attemptNo}`))
      .toHaveLength(1);
  });

  it("makes an expired or late attempt effect-free", async () => {
    const stale = (await leases.claimNext(jobId, "worker-a", new Date()))!;
    await postgres.db.updateTable("job_steps").set({
      lease_expires_at: sql<Date>`clock_timestamp() - interval '1 second'`,
    }).where("id", "=", stale.stepId).execute();
    const current = (await leases.claimNext(jobId, "worker-b", new Date()))!;
    const original = await postgres.db.selectFrom("job_steps").selectAll()
      .where("id", "=", stale.stepId).executeTakeFirstOrThrow();
    await expect(leases.deferStep(stale, {
      bookId: (original.output_ref as { bookId: string }).bookId,
      stage: "l1",
      l1JobId: crypto.randomUUID(),
    })).resolves.toEqual({ disposition: "terminal-noop" });
    const after = await postgres.db.selectFrom("job_steps").selectAll()
      .where("id", "=", stale.stepId).executeTakeFirstOrThrow();
    expect(after).toEqual(original);
    expect(after.lease_owner).toBe(current.workerId);
  });
});
