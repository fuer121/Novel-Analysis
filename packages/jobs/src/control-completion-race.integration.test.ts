import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDisposablePostgres,
  type DisposablePostgres,
} from "../../database/src/testing/postgres.js";

import { JobControls } from "./job-controls.js";
import { JobRepository } from "./job-repository.js";
import { PostgresStepLeaseService, type ClaimedStep } from "./step-leases.js";

describe("job control and completion boundaries", () => {
  let postgres: DisposablePostgres;
  let ownerId: string;

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    ownerId = (await postgres.db.insertInto("users").values({
      display_name: "Owner",
      avatar_url: null,
      role: "member",
      status: "active",
    }).returning("id").executeTakeFirstOrThrow()).id;
  });

  afterEach(async () => {
    await postgres.destroy();
  });

  async function runningJob(requestId: string): Promise<{ jobId: string; claim: ClaimedStep }> {
    const jobId = (await new JobRepository(postgres.db).createExample({ requestedBy: ownerId, requestId })).id;
    const claim = await new PostgresStepLeaseService({ database: postgres.db }).claimNext(
      jobId,
      "worker-a",
      new Date(),
    );
    return { jobId, claim: claim! };
  }

  function control(jobId: string, action: "pause" | "cancel", requestId: string) {
    return new JobControls(postgres.db).control({
      jobId,
      actor: { userId: ownerId, role: "member" },
      action,
      requestId,
    });
  }

  async function blockUpdates(table: "jobs" | "job_steps", key: number) {
    const functionName = `block_${table}_update`;
    const triggerName = `block_${table}_update_trigger`;
    await sql`
      create function ${sql.id(functionName)}() returns trigger language plpgsql as $$
      begin
        perform pg_advisory_xact_lock(${sql.raw(String(key))});
        return new;
      end
      $$
    `.execute(postgres.db);
    await sql`
      create trigger ${sql.id(triggerName)} before update on ${sql.table(table)}
      for each row execute function ${sql.id(functionName)}()
    `.execute(postgres.db);

    let release!: () => void;
    let locked!: () => void;
    const acquired = new Promise<void>((resolve) => { locked = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const holder = postgres.db.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(${key})`.execute(transaction);
      locked();
      await gate;
    });
    await acquired;
    return { release, holder };
  }

  async function waitForJobLock(jobId: string): Promise<void> {
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      try {
        await postgres.db.transaction().execute(async (transaction) => {
          await transaction.selectFrom("jobs").select("id").where("id", "=", jobId)
            .forUpdate().noWait().executeTakeFirstOrThrow();
        });
      } catch (error) {
        if ((error as { code?: string }).code === "55P03") return;
        throw error;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error("Timed out waiting for the job row lock");
  }

  it("pause winning the job lock commits only the current boundary", async () => {
    const { jobId, claim } = await runningJob("pause-first");
    const blocker = await blockUpdates("jobs", 42_001);
    const pausing = control(jobId, "pause", "pause-first-control");
    await waitForJobLock(jobId);
    const completing = new PostgresStepLeaseService({ database: postgres.db })
      .completeStep(claim, { ok: true });
    blocker.release();
    await blocker.holder;
    await pausing;

    await expect(completing)
      .resolves.toEqual({ disposition: "paused-boundary" });
    expect((await new JobRepository(postgres.db).getById(jobId))?.status).toBe("paused");
    expect(await postgres.db.selectFrom("job_outbox").selectAll().where("job_id", "=", jobId).execute())
      .toHaveLength(1);
  });

  it("cancel winning the job lock discards late output", async () => {
    const { jobId, claim } = await runningJob("cancel-first");
    const blocker = await blockUpdates("jobs", 42_002);
    const cancelling = control(jobId, "cancel", "cancel-first-control");
    await waitForJobLock(jobId);
    const completing = new PostgresStepLeaseService({ database: postgres.db })
      .completeStep(claim, { late: true });
    blocker.release();
    await blocker.holder;
    await cancelling;

    await expect(completing)
      .resolves.toEqual({ disposition: "discarded-cancelled" });
    expect((await new JobRepository(postgres.db).getById(jobId))?.status).toBe("cancelled");
    expect((await postgres.db.selectFrom("jobs").select("progress")
      .where("id", "=", jobId).executeTakeFirstOrThrow()).progress).toMatchObject({ completed: 0 });
    expect((await postgres.db.selectFrom("job_steps").select("output_ref")
      .where("id", "=", claim.stepId).executeTakeFirstOrThrow()).output_ref).toBeNull();
  });

  it("non-final completion winning the job lock completes before pause", async () => {
    const { jobId, claim } = await runningJob("completion-first-pause");
    const service = new PostgresStepLeaseService({ database: postgres.db });
    const blocker = await blockUpdates("job_steps", 42_003);
    const completing = service.completeStep(claim, { ok: true });
    await waitForJobLock(jobId);
    const pausing = control(jobId, "pause", "pause-after-completion");
    blocker.release();
    await blocker.holder;

    await expect(completing).resolves.toEqual({ disposition: "completed" });
    await expect(pausing).resolves.toMatchObject({ status: "paused" });

    expect((await postgres.db.selectFrom("jobs").select("progress")
      .where("id", "=", jobId).executeTakeFirstOrThrow()).progress).toMatchObject({ completed: 1 });
  });

  it("final completion winning the job lock makes waiting control invalid", async () => {
    const { jobId, claim: first } = await runningJob("final-completion-first");
    const service = new PostgresStepLeaseService({ database: postgres.db });
    await service.completeStep(first, { position: 0 });
    const final = (await service.claimNext(jobId, "worker-a", new Date()))!;
    const blocker = await blockUpdates("job_steps", 42_004);
    const completing = service.completeStep(final, { position: 1 });
    await waitForJobLock(jobId);
    const pausing = control(jobId, "pause", "pause-too-late");
    blocker.release();
    await blocker.holder;

    await expect(completing).resolves.toEqual({ disposition: "completed" });
    await expect(pausing)
      .rejects.toMatchObject({ name: "InvalidJobTransitionError", from: "completed", to: "paused" });
    expect((await new JobRepository(postgres.db).getById(jobId))?.status).toBe("completed");
  });

  it.each(
    (["completed", "failed", "cancelled"] as const).flatMap((terminal) => (
      (["pause", "resume", "cancel"] as const).map((action) => [terminal, action] as const)
    )),
  )("%s jobs reject %s without control side effects", async (terminal, action) => {
      const { jobId } = await runningJob(`terminal-${terminal}-${action}`);
      await postgres.db.updateTable("jobs").set({ status: terminal }).where("id", "=", jobId).execute();
      const before = {
        events: await postgres.db.selectFrom("job_events").selectAll().where("job_id", "=", jobId).execute(),
        audits: await postgres.db.selectFrom("audit_logs").selectAll().where("target_id", "=", jobId).execute(),
        outbox: await postgres.db.selectFrom("job_outbox").selectAll().where("job_id", "=", jobId).execute(),
      };

      await expect(new JobControls(postgres.db).control({
        jobId,
        actor: { userId: ownerId, role: "member" },
        action,
        requestId: `control-${terminal}-${action}`,
      })).rejects.toMatchObject({
        name: "InvalidJobTransitionError",
      });
      expect((await new JobRepository(postgres.db).getById(jobId))?.status).toBe(terminal);
      expect(await postgres.db.selectFrom("job_events").selectAll().where("job_id", "=", jobId).execute())
        .toEqual(before.events);
      expect(await postgres.db.selectFrom("audit_logs").selectAll().where("target_id", "=", jobId).execute())
        .toEqual(before.audits);
      expect(await postgres.db.selectFrom("job_outbox").selectAll().where("job_id", "=", jobId).execute())
        .toEqual(before.outbox);
  });

  it.each(["completed", "failed", "cancelled"] as const)(
    "late completion does not change terminal %s",
    async (terminal) => {
      const { jobId, claim } = await runningJob(`terminal-completion-${terminal}`);
      await postgres.db.updateTable("jobs").set({ status: terminal }).where("id", "=", jobId).execute();
      await expect(new PostgresStepLeaseService({ database: postgres.db }).completeStep(claim, { late: true }))
        .resolves.toEqual({ disposition: terminal === "cancelled" ? "discarded-cancelled" : "terminal-noop" });
      expect((await new JobRepository(postgres.db).getById(jobId))?.status).toBe(terminal);
    },
  );
});
