import { sql } from "kysely";

import type { DatabaseConnection } from "@novel-analysis/database";
import { RebuildStepRefSchema, type RebuildStepRef } from "@novel-analysis/contracts";

const DEFAULT_LEASE_DURATION_MS = 30_000;

export interface ExecutionBarrier {
  afterAttemptStarted(input: {
    jobId: string;
    stepId: string;
    attemptId: string;
    attemptNo: number;
  }): Promise<void>;
}

export type ClaimedStep = {
  jobId: string;
  stepId: string;
  attemptId: string;
  attemptNo: number;
  position: number;
  kind: string;
  workerId: string;
  leaseExpiresAt: Date;
};

export type CompletionDisposition =
  | "completed"
  | "already-completed"
  | "paused-boundary"
  | "discarded-cancelled"
  | "terminal-noop";

export type DeferDisposition = "deferred" | Exclude<CompletionDisposition, "completed">;

export interface StepLeaseService {
  claimNext(jobId: string, workerId: string, now: Date): Promise<ClaimedStep | null>;
  completeStep(
    claim: ClaimedStep,
    output: unknown,
  ): Promise<{ disposition: CompletionDisposition }>;
}

function asJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { value };
  }
  return value as Record<string, unknown>;
}

export class PostgresStepLeaseService implements StepLeaseService {
  private readonly leaseDurationMs: number;

  constructor(private readonly options: {
    database: DatabaseConnection;
    leaseDurationMs?: number;
  }) {
    this.leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  }

  claimNext(jobId: string, workerId: string, _now: Date): Promise<ClaimedStep | null> {
    return this.options.database.transaction().execute(async (transaction) => {
      const job = await transaction.selectFrom("jobs")
        .select(["id", "status"])
        .where("id", "=", jobId)
        .forUpdate()
        .executeTakeFirst();
      if (!job || ["paused", "completed", "failed", "cancelled"].includes(job.status)) {
        return null;
      }

      const step = await transaction.selectFrom("job_steps")
        .selectAll()
        .where("job_id", "=", jobId)
        .where("status", "!=", "completed")
        .orderBy("position")
        .forUpdate()
        .executeTakeFirst();
      const databaseNow = (await sql<{ now: Date }>`
        select clock_timestamp() as now
      `.execute(transaction)).rows[0]!.now;
      if (!step) {
        await transaction.updateTable("jobs")
          .set({ status: "completed", updated_at: databaseNow })
          .where("id", "=", jobId)
          .execute();
        await transaction.insertInto("job_events").values({
          job_id: jobId,
          type: "completed",
          dedupe_key: "completed",
          payload: { status: "completed" },
        }).onConflict((conflict) => conflict.columns(["job_id", "dedupe_key"]).doNothing())
          .execute();
        return null;
      }
      if (step.status === "cancelled" || step.status === "failed") return null;
      if (
        step.status === "running"
        && step.lease_expires_at
        && step.lease_expires_at.getTime() > databaseNow.getTime()
      ) {
        return null;
      }

      if (step.status === "running") {
        await transaction.updateTable("job_attempts")
          .set({ status: "abandoned", finished_at: databaseNow })
          .where("step_id", "=", step.id)
          .where("status", "=", "running")
          .execute();
      }

      const attemptNo = step.attempt_count + 1;
      const leaseExpiresAt = new Date(databaseNow.getTime() + this.leaseDurationMs);
      await transaction.updateTable("job_steps").set({
        status: "running",
        lease_owner: workerId,
        lease_expires_at: leaseExpiresAt,
        attempt_count: attemptNo,
        updated_at: databaseNow,
      }).where("id", "=", step.id).executeTakeFirstOrThrow();
      const attempt = await transaction.insertInto("job_attempts").values({
        step_id: step.id,
        attempt_no: attemptNo,
        worker_id: workerId,
        status: "running",
        error_code: null,
        error_message: null,
        started_at: databaseNow,
        finished_at: null,
      }).returning("id").executeTakeFirstOrThrow();
      if (job.status !== "running") {
        await transaction.updateTable("jobs")
          .set({ status: "running", updated_at: databaseNow })
          .where("id", "=", jobId)
          .execute();
        await transaction.insertInto("job_events").values({
          job_id: jobId,
          type: "running",
          dedupe_key: "running",
          payload: { status: "running" },
        }).onConflict((conflict) => conflict.columns(["job_id", "dedupe_key"]).doNothing())
          .execute();
      }

      return {
        jobId,
        stepId: step.id,
        attemptId: attempt.id,
        attemptNo,
        position: step.position,
        kind: step.kind,
        workerId,
        leaseExpiresAt,
      };
    });
  }

  completeStep(
    claim: ClaimedStep,
    output: unknown,
  ): Promise<{ disposition: CompletionDisposition }> {
    return this.options.database.transaction().execute(async (transaction) => {
      const job = await transaction.selectFrom("jobs")
        .select(["status", "progress"])
        .where("id", "=", claim.jobId)
        .forUpdate()
        .executeTakeFirst();
      if (!job) return { disposition: "terminal-noop" };

      const step = await transaction.selectFrom("job_steps")
        .selectAll()
        .where("id", "=", claim.stepId)
        .where("job_id", "=", claim.jobId)
        .forUpdate()
        .executeTakeFirst();
      if (!step) return { disposition: "terminal-noop" };
      if (step.status === "completed") return { disposition: "already-completed" };
      if (job.status === "cancelled") return { disposition: "discarded-cancelled" };
      if (job.status === "completed" || job.status === "failed") {
        return { disposition: "terminal-noop" };
      }
      const databaseNow = (await sql<{ now: Date }>`
        select clock_timestamp() as now
      `.execute(transaction)).rows[0]!.now;
      if (
        step.status !== "running"
        || step.lease_owner !== claim.workerId
        || step.attempt_count !== claim.attemptNo
        || step.lease_expires_at?.getTime() !== claim.leaseExpiresAt.getTime()
        || step.lease_expires_at.getTime() <= databaseNow.getTime()
      ) {
        return { disposition: "terminal-noop" };
      }
      const attempt = await transaction.selectFrom("job_attempts")
        .select(["id", "step_id", "attempt_no", "worker_id", "status"])
        .where("id", "=", claim.attemptId)
        .forUpdate()
        .executeTakeFirst();
      if (
        !attempt
        || attempt.step_id !== claim.stepId
        || attempt.attempt_no !== claim.attemptNo
        || attempt.worker_id !== claim.workerId
        || attempt.status !== "running"
      ) {
        return { disposition: "terminal-noop" };
      }

      await transaction.updateTable("job_steps").set({
        status: "completed",
        output_ref: asJsonObject(output),
        lease_owner: null,
        lease_expires_at: null,
        updated_at: databaseNow,
      }).where("id", "=", step.id).executeTakeFirstOrThrow();
      await transaction.updateTable("job_attempts").set({
        status: "completed",
        finished_at: databaseNow,
      }).where("id", "=", attempt.id).executeTakeFirstOrThrow();

      const progress = { ...job.progress };
      progress.completed = Number(progress.completed ?? 0) + 1;
      progress.current = step.kind;
      await transaction.updateTable("jobs").set({ progress, updated_at: databaseNow })
        .where("id", "=", claim.jobId).execute();
      await transaction.insertInto("job_events").values({
        job_id: claim.jobId,
        type: "progress",
        dedupe_key: `step:${step.id}:completed`,
        payload: { stepId: step.id, position: step.position, progress },
      }).onConflict((conflict) => conflict.columns(["job_id", "dedupe_key"]).doNothing())
        .execute();

      if (job.status === "paused") return { disposition: "paused-boundary" };

      const remaining = await transaction.selectFrom("job_steps")
        .select("id")
        .where("job_id", "=", claim.jobId)
        .where("status", "!=", "completed")
        .executeTakeFirst();
      if (!remaining) {
        await transaction.updateTable("jobs").set({ status: "completed", updated_at: databaseNow })
          .where("id", "=", claim.jobId).execute();
        await transaction.insertInto("job_events").values({
          job_id: claim.jobId,
          type: "completed",
          dedupe_key: "completed",
          payload: { status: "completed", progress },
        }).onConflict((conflict) => conflict.columns(["job_id", "dedupe_key"]).doNothing())
          .execute();
      } else {
        await transaction.insertInto("job_outbox").values({
          job_id: claim.jobId,
          topic: "jobs.wake",
          payload: { jobId: claim.jobId },
          claimed_by: null,
          claim_expires_at: null,
          delivered_at: null,
        }).execute();
      }
      return { disposition: "completed" };
    });
  }

  deferStep(
    claim: ClaimedStep,
    outputRef: RebuildStepRef,
    delayMs = 1_000,
  ): Promise<{ disposition: DeferDisposition }> {
    const validatedRef = RebuildStepRefSchema.parse(outputRef);
    if (!Number.isSafeInteger(delayMs) || delayMs < 0) {
      return Promise.reject(new Error("Invalid defer delay"));
    }
    return this.options.database.transaction().execute(async (transaction) => {
      const job = await transaction.selectFrom("jobs").select("status")
        .where("id", "=", claim.jobId).forUpdate().executeTakeFirst();
      if (!job) return { disposition: "terminal-noop" };
      const step = await transaction.selectFrom("job_steps").selectAll()
        .where("id", "=", claim.stepId).where("job_id", "=", claim.jobId)
        .forUpdate().executeTakeFirst();
      if (!step) return { disposition: "terminal-noop" };
      if (step.status === "completed") return { disposition: "already-completed" };
      if (job.status === "cancelled") return { disposition: "discarded-cancelled" };
      if (job.status === "completed" || job.status === "failed") return { disposition: "terminal-noop" };
      const databaseNow = (await sql<{ now: Date }>`select clock_timestamp() as now`
        .execute(transaction)).rows[0]!.now;
      if (step.status !== "running"
        || step.lease_owner !== claim.workerId
        || step.attempt_count !== claim.attemptNo
        || step.lease_expires_at?.getTime() !== claim.leaseExpiresAt.getTime()
        || step.lease_expires_at.getTime() <= databaseNow.getTime()) {
        return { disposition: "terminal-noop" };
      }
      const attempt = await transaction.selectFrom("job_attempts").selectAll()
        .where("id", "=", claim.attemptId).forUpdate().executeTakeFirst();
      if (!attempt || attempt.step_id !== claim.stepId || attempt.attempt_no !== claim.attemptNo
        || attempt.worker_id !== claim.workerId || attempt.status !== "running") {
        return { disposition: "terminal-noop" };
      }
      await transaction.updateTable("job_attempts").set({
        status: "completed",
        finished_at: databaseNow,
      }).where("id", "=", attempt.id).executeTakeFirstOrThrow();
      await transaction.updateTable("job_steps").set({
        status: "queued",
        output_ref: validatedRef,
        lease_owner: null,
        lease_expires_at: null,
        updated_at: databaseNow,
      }).where("id", "=", step.id).executeTakeFirstOrThrow();
      const dedupeKey = `defer:${step.id}:${claim.attemptNo}`;
      const pending = await transaction.selectFrom("job_outbox").select(["id", "payload"])
        .where("job_id", "=", claim.jobId).where("topic", "=", "jobs.wake")
        .where("delivered_at", "is", null).execute();
      if (!pending.some((wake) => wake.payload.dedupeKey === dedupeKey)) {
        await transaction.insertInto("job_outbox").values({
          job_id: claim.jobId,
          topic: "jobs.wake",
          payload: { jobId: claim.jobId, dedupeKey },
          available_at: new Date(databaseNow.getTime() + delayMs),
          claimed_by: null,
          claim_expires_at: null,
          delivered_at: null,
        }).execute();
      }
      return { disposition: "deferred" };
    });
  }
}
