import {
  PublicJobSchema,
  type JobListResponse,
  type PublicJob,
} from "@novel-analysis/contracts";
import type {
  DatabaseConnection,
  DatabaseExecutor,
} from "@novel-analysis/database";

export const PUBLIC_JOB_COLUMNS = [
  "id",
  "type",
  "status",
  "requested_by",
  "scope",
  "progress",
  "created_at",
  "updated_at",
] as const;

type PublicJobRow = {
  id: string;
  type: string;
  status: string;
  requested_by: string;
  scope: Record<string, unknown>;
  progress: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

export class InvalidJobCursorError extends Error {
  constructor() {
    super("Invalid job cursor");
    this.name = "InvalidJobCursorError";
  }
}

export function jobRowToPublic(row: PublicJobRow): PublicJob {
  return PublicJobSchema.parse({
    id: row.id,
    type: row.type,
    status: row.status,
    requestedBy: row.requested_by,
    scope: row.scope,
    progress: row.progress,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });
}

export async function selectPublicJob(
  database: DatabaseExecutor,
  id: string,
): Promise<PublicJob | null> {
  const row = await database.selectFrom("jobs")
    .select(PUBLIC_JOB_COLUMNS)
    .where("id", "=", id)
    .executeTakeFirst();
  return row ? jobRowToPublic(row) : null;
}

function encodeCursor(job: PublicJob): string {
  return Buffer.from(JSON.stringify({ createdAt: job.createdAt, id: job.id }))
    .toString("base64url");
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (!value || typeof value !== "object") throw new InvalidJobCursorError();
    const { createdAt, id } = value as Record<string, unknown>;
    if (typeof createdAt !== "string" || typeof id !== "string") {
      throw new InvalidJobCursorError();
    }
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime()) || !UUID_PATTERN.test(id)) {
      throw new InvalidJobCursorError();
    }
    return { createdAt: date, id };
  } catch (error) {
    if (error instanceof InvalidJobCursorError) throw error;
    throw new InvalidJobCursorError();
  }
}

export class JobRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async createExample(input: {
    requestedBy: string;
    requestId: string;
  }): Promise<PublicJob> {
    return this.database.transaction().execute(async (transaction) => {
      const inserted = await transaction.insertInto("jobs").values({
        type: "query",
        status: "queued",
        requested_by: input.requestedBy,
        request_id: input.requestId,
        scope: { bookId: "phase-1-example" },
        config_snapshot: {},
        concurrency_key: null,
        progress: { total: 2, completed: 0, failed: 0, skipped: 0, current: "" },
      }).onConflict((conflict) => conflict
        .columns(["requested_by", "request_id"])
        .doNothing())
        .returning(PUBLIC_JOB_COLUMNS)
        .executeTakeFirst();

      if (!inserted) {
        const existing = await transaction.selectFrom("jobs")
          .select(PUBLIC_JOB_COLUMNS)
          .where("requested_by", "=", input.requestedBy)
          .where("request_id", "=", input.requestId)
          .executeTakeFirstOrThrow();
        return jobRowToPublic(existing);
      }

      const job = jobRowToPublic(inserted);
      await transaction.insertInto("job_steps").values([0, 1].map((position) => ({
        job_id: job.id,
        position,
        kind: "example",
        status: "queued" as const,
        input_signature: `example:${position}`,
        idempotency_key: `${job.id}:${position}`,
        output_ref: null,
        lease_owner: null,
        lease_expires_at: null,
      }))).execute();
      await transaction.insertInto("job_events").values({
        job_id: job.id,
        type: "created",
        dedupe_key: "created",
        payload: { status: "queued" },
      }).execute();
      await transaction.insertInto("job_outbox").values({
        job_id: job.id,
        topic: "jobs.wake",
        payload: { jobId: job.id },
        claimed_by: null,
        claim_expires_at: null,
        delivered_at: null,
      }).execute();
      return job;
    });
  }

  getById(id: string): Promise<PublicJob | null> {
    return selectPublicJob(this.database, id);
  }

  async list(input: { limit: number; cursor?: string }): Promise<JobListResponse> {
    let query = this.database.selectFrom("jobs").select(PUBLIC_JOB_COLUMNS);
    if (input.cursor) {
      const cursor = decodeCursor(input.cursor);
      query = query.where((expression) => expression.or([
        expression("created_at", "<", cursor.createdAt),
        expression.and([
          expression("created_at", "=", cursor.createdAt),
          expression("id", "<", cursor.id),
        ]),
      ]));
    }
    const rows = await query.orderBy("created_at", "desc").orderBy("id", "desc")
      .limit(input.limit + 1).execute();
    const jobs = rows.slice(0, input.limit).map(jobRowToPublic);
    return {
      jobs,
      nextCursor: rows.length > input.limit && jobs.length > 0
        ? encodeCursor(jobs[jobs.length - 1]!)
        : null,
    };
  }
}
