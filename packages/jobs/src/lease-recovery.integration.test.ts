import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDisposablePostgres,
  type DisposablePostgres,
} from "../../database/src/testing/postgres.js";

import { JobRepository } from "./job-repository.js";
import { PostgresStepLeaseService } from "./step-leases.js";

describe("step lease recovery", () => {
  let postgres: DisposablePostgres;
  let jobId: string;

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    const userId = (await postgres.db.insertInto("users").values({
      display_name: "Owner",
      avatar_url: null,
      role: "member",
      status: "active",
    }).returning("id").executeTakeFirstOrThrow()).id;
    jobId = (await new JobRepository(postgres.db).createExample({
      requestedBy: userId,
      requestId: "lease-recovery",
    })).id;
  });

  afterEach(async () => {
    await postgres.destroy();
  });

  function leases(leaseDurationMs = 1_000) {
    return new PostgresStepLeaseService({ database: postgres.db, leaseDurationMs });
  }

  async function databaseNow(): Promise<Date> {
    return (await sql<{ now: Date }>`select transaction_timestamp() as now`
      .execute(postgres.db)).rows[0]!.now;
  }

  it("does not let a caller clock one hour ahead reclaim a database-live lease", async () => {
    const first = await leases(60_000).claimNext(jobId, "worker-a", new Date());
    const authoritativeNow = await databaseNow();

    expect(first).not.toBeNull();
    await expect(leases().claimNext(
      jobId,
      "worker-b",
      new Date(authoritativeNow.getTime() + 3_600_000),
    ))
      .resolves.toBeNull();
    expect(await postgres.db.selectFrom("job_attempts").selectAll().execute()).toHaveLength(1);
  });

  it("lets a caller clock one hour behind recover a database-expired lease", async () => {
    const first = await leases().claimNext(jobId, "worker-a", new Date());
    await postgres.db.updateTable("job_steps").set({
      lease_expires_at: sql<Date>`transaction_timestamp() - interval '1 second'`,
    }).where("id", "=", first!.stepId).execute();
    const authoritativeNow = await databaseNow();
    const recovered = await leases().claimNext(
      jobId,
      "worker-b",
      new Date(authoritativeNow.getTime() - 3_600_000),
    );

    expect(recovered).toMatchObject({ stepId: first!.stepId, workerId: "worker-b", attemptNo: 2 });
    expect(await postgres.db.selectFrom("job_attempts")
      .select(["attempt_no", "worker_id", "status", "finished_at"])
      .orderBy("attempt_no").execute()).toEqual([
      { attempt_no: 1, worker_id: "worker-a", status: "abandoned", finished_at: expect.any(Date) },
      { attempt_no: 2, worker_id: "worker-b", status: "running", finished_at: null },
    ]);
  });

  it("recovers when the lease expires while claim waits for the job lock", async () => {
    const first = await leases(60_000).claimNext(jobId, "worker-a", new Date());
    let notifyLocked!: () => void;
    const locked = new Promise<void>((resolve) => { notifyLocked = resolve; });
    const holder = postgres.db.transaction().execute(async (transaction) => {
      await transaction.selectFrom("jobs").select("id").where("id", "=", jobId)
        .forUpdate().executeTakeFirstOrThrow();
      await transaction.updateTable("job_steps").set({
        lease_expires_at: sql<Date>`clock_timestamp() + interval '500 milliseconds'`,
      }).where("id", "=", first!.stepId).execute();
      notifyLocked();
      await sql`select pg_sleep(1)`.execute(transaction);
    });
    await locked;

    const recovering = leases().claimNext(jobId, "worker-b", new Date());
    await holder;

    await expect(recovering).resolves.toMatchObject({
      stepId: first!.stepId,
      workerId: "worker-b",
      attemptNo: 2,
    });
  });

  it("completes once and makes duplicate or stale completion effect-free", async () => {
    const stale = (await leases().claimNext(jobId, "worker-a", new Date()))!;
    await postgres.db.updateTable("job_steps").set({
      lease_expires_at: sql<Date>`transaction_timestamp() - interval '1 second'`,
    }).where("id", "=", stale.stepId).execute();
    const current = (await leases().claimNext(jobId, "worker-b", new Date()))!;
    const output = { value: "attempt-2" };

    await expect(leases().completeStep(stale, { value: "late-attempt-1" }))
      .resolves.toEqual({ disposition: "terminal-noop" });
    await expect(leases().completeStep(current, output)).resolves.toEqual({ disposition: "completed" });
    await expect(leases().completeStep(current, { value: "duplicate" }))
      .resolves.toEqual({ disposition: "already-completed" });
    await expect(leases().completeStep(stale, { value: "late-attempt-1" }))
      .resolves.toEqual({ disposition: "already-completed" });

    expect(await postgres.db.selectFrom("job_steps").select(["status", "output_ref"])
      .where("id", "=", current.stepId).executeTakeFirstOrThrow()).toEqual({
      status: "completed",
      output_ref: output,
    });
    expect((await postgres.db.selectFrom("jobs").select("progress")
      .where("id", "=", jobId).executeTakeFirstOrThrow()).progress).toMatchObject({ completed: 1 });
    expect(await postgres.db.selectFrom("job_events").selectAll()
      .where("job_id", "=", jobId).where("dedupe_key", "=", `step:${current.stepId}:completed`).execute())
      .toHaveLength(1);
    expect(await postgres.db.selectFrom("job_outbox").selectAll().where("job_id", "=", jobId).execute())
      .toHaveLength(2);
  });

  it("rejects an expired owner before writing completion effects", async () => {
    const claim = (await leases().claimNext(jobId, "worker-a", new Date()))!;
    const expired = await postgres.db.updateTable("job_steps").set({
      lease_expires_at: sql<Date>`transaction_timestamp() - interval '1 second'`,
    }).where("id", "=", claim.stepId).returning("lease_expires_at").executeTakeFirstOrThrow();

    await expect(leases().completeStep({
      ...claim,
      leaseExpiresAt: expired.lease_expires_at!,
    }, { expired: true })).resolves.toEqual({ disposition: "terminal-noop" });
    expect(await postgres.db.selectFrom("job_steps").select(["status", "output_ref"])
      .where("id", "=", claim.stepId).executeTakeFirstOrThrow()).toEqual({
      status: "running",
      output_ref: null,
    });
    expect((await postgres.db.selectFrom("jobs").select("progress")
      .where("id", "=", jobId).executeTakeFirstOrThrow()).progress).toMatchObject({ completed: 0 });
    expect(await postgres.db.selectFrom("job_events").selectAll()
      .where("job_id", "=", jobId).where("type", "=", "progress").execute()).toHaveLength(0);
  });

  it("rejects completion when the lease expires while waiting for the job lock", async () => {
    const claim = (await leases(60_000).claimNext(jobId, "worker-a", new Date()))!;
    let leaseExpiresAt!: Date;
    let notifyLocked!: () => void;
    const locked = new Promise<void>((resolve) => { notifyLocked = resolve; });
    const holder = postgres.db.transaction().execute(async (transaction) => {
      await transaction.selectFrom("jobs").select("id").where("id", "=", jobId)
        .forUpdate().executeTakeFirstOrThrow();
      leaseExpiresAt = (await transaction.updateTable("job_steps").set({
        lease_expires_at: sql<Date>`clock_timestamp() + interval '500 milliseconds'`,
      }).where("id", "=", claim.stepId).returning("lease_expires_at")
        .executeTakeFirstOrThrow()).lease_expires_at!;
      notifyLocked();
      await sql`select pg_sleep(1)`.execute(transaction);
    });
    await locked;

    const completing = leases().completeStep({ ...claim, leaseExpiresAt }, { tooLate: true });
    await holder;

    await expect(completing).resolves.toEqual({ disposition: "terminal-noop" });
    expect(await postgres.db.selectFrom("job_steps").select(["status", "output_ref"])
      .where("id", "=", claim.stepId).executeTakeFirstOrThrow()).toEqual({
      status: "running",
      output_ref: null,
    });
    expect((await postgres.db.selectFrom("jobs").select("progress")
      .where("id", "=", jobId).executeTakeFirstOrThrow()).progress).toMatchObject({ completed: 0 });
    expect(await postgres.db.selectFrom("job_events").selectAll()
      .where("job_id", "=", jobId).where("type", "=", "progress").execute()).toHaveLength(0);
    expect(await postgres.db.selectFrom("job_outbox").selectAll()
      .where("job_id", "=", jobId).execute()).toHaveLength(1);
  });

  it("rejects a completion whose attempt identity does not match the lease", async () => {
    const claim = (await leases().claimNext(jobId, "worker-a", new Date()))!;

    await expect(leases().completeStep({ ...claim, attemptId: jobId }, { forged: true }))
      .resolves.toEqual({ disposition: "terminal-noop" });
    expect((await postgres.db.selectFrom("job_steps").select("status")
      .where("id", "=", claim.stepId).executeTakeFirstOrThrow()).status).toBe("running");
    await expect(leases().completeStep(claim, { valid: true }))
      .resolves.toEqual({ disposition: "completed" });
  });

  it("claims only the first step whose predecessors are complete", async () => {
    const service = leases();
    const first = (await service.claimNext(jobId, "worker-a", new Date()))!;
    await expect(service.claimNext(jobId, "worker-b", new Date())).resolves.toBeNull();
    await service.completeStep(first, { position: 0 });

    const second = await service.claimNext(jobId, "worker-b", new Date());
    expect(second).toMatchObject({ position: 1, attemptNo: 1 });
  });
});
