import {
  PublicJobSchema,
  type JobEventType,
  type JobStatus,
  type PublicJob,
} from "@novel-analysis/contracts";
import type { DatabaseConnection } from "@novel-analysis/database";
import { assertJobTransition, type Role } from "@novel-analysis/domain";

import {
  jobRowToPublic,
  PUBLIC_JOB_COLUMNS,
} from "./job-repository.js";

export type JobControlAction = "pause" | "resume" | "cancel";

export class JobNotFoundError extends Error {
  constructor() {
    super("Job not found");
    this.name = "JobNotFoundError";
  }
}

export class JobControlForbiddenError extends Error {
  constructor() {
    super("Job control forbidden");
    this.name = "JobControlForbiddenError";
  }
}

const targetStatus: Record<JobControlAction, JobStatus> = {
  pause: "paused",
  resume: "queued",
  cancel: "cancelled",
};

const eventType: Record<JobControlAction, JobEventType> = {
  pause: "paused",
  resume: "resumed",
  cancel: "cancelled",
};

const auditAction: Record<JobControlAction, string> = {
  pause: "job.paused",
  resume: "job.resumed",
  cancel: "job.cancelled",
};

export class JobControls {
  constructor(private readonly database: DatabaseConnection) {}

  async control(input: {
    jobId: string;
    actor: { userId: string; role: Role };
    action: JobControlAction;
    requestId: string;
  }): Promise<PublicJob> {
    return this.database.transaction().execute(async (transaction) => {
      const locked = await transaction.selectFrom("jobs")
        .select(PUBLIC_JOB_COLUMNS)
        .where("id", "=", input.jobId)
        .forUpdate()
        .executeTakeFirst();
      if (!locked) throw new JobNotFoundError();
      if (input.actor.role !== "admin" && locked.requested_by !== input.actor.userId) {
        throw new JobControlForbiddenError();
      }

      const dedupeKey = [
        "control",
        input.actor.userId,
        input.action,
        input.requestId,
      ].join(":");
      const prior = await transaction.selectFrom("job_events")
        .select("payload")
        .where("job_id", "=", input.jobId)
        .where("dedupe_key", "=", dedupeKey)
        .executeTakeFirst();
      if (prior) {
        return PublicJobSchema.parse(prior.payload.result);
      }

      const from = locked.status;
      const to = targetStatus[input.action];
      assertJobTransition(from, to);
      const now = new Date();
      const updated = await transaction.updateTable("jobs")
        .set({ status: to, updated_at: now })
        .where("id", "=", input.jobId)
        .returning(PUBLIC_JOB_COLUMNS)
        .executeTakeFirstOrThrow();
      const result = jobRowToPublic(updated);

      if (locked.type === "advanced-analysis") {
        const activeRunStatuses = input.action === "resume"
          ? ["paused" as const]
          : ["queued" as const, "running" as const, "retrying" as const, "paused" as const];
        await transaction.updateTable("analysis_runs")
          .set({ status: to, updated_at: now })
          .where("job_id", "=", input.jobId)
          .where("status", "in", activeRunStatuses)
          .execute();
      }

      if (input.action === "cancel") {
        const unfinishedSteps = transaction.selectFrom("job_steps")
          .select("id")
          .where("job_id", "=", input.jobId);
        await transaction.updateTable("job_attempts")
          .set({ status: "cancelled", finished_at: now })
          .where("status", "=", "running")
          .where("step_id", "in", unfinishedSteps)
          .execute();
        await transaction.updateTable("job_steps")
          .set({
            status: "cancelled",
            lease_owner: null,
            lease_expires_at: null,
            updated_at: now,
          })
          .where("job_id", "=", input.jobId)
          .where("status", "in", ["queued", "running", "failed"])
          .execute();
      }

      await transaction.insertInto("job_events").values({
        job_id: input.jobId,
        type: eventType[input.action],
        dedupe_key: dedupeKey,
        payload: { from, to, requestId: input.requestId, result },
      }).onConflict((conflict) => conflict
        .columns(["job_id", "dedupe_key"])
        .doNothing())
        .execute();
      await transaction.insertInto("audit_logs").values({
        actor_user_id: input.actor.userId,
        action: auditAction[input.action],
        target_type: "job",
        target_id: input.jobId,
        metadata: { from, to, request_id: input.requestId },
      }).execute();
      if (input.action === "resume") {
        await transaction.insertInto("job_outbox").values({
          job_id: input.jobId,
          topic: "jobs.wake",
          payload: { jobId: input.jobId },
          claimed_by: null,
          claim_expires_at: null,
          delivered_at: null,
        }).execute();
      }
      return result;
    });
  }
}
