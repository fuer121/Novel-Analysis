import { createHmac } from "node:crypto";
import { sql, type Transaction } from "kysely";

import { ChapterImportOutputSchema } from "@novel-analysis/contracts";
import { createLibraryRepository, type ContentCipher, type Database, type DatabaseConnection } from "@novel-analysis/database";
import { DifyAdapterError, type DifyAdapter } from "@novel-analysis/dify";
import { createImportL1Handoff, type ClaimedStep, type CompletionDisposition } from "@novel-analysis/jobs";

type JobConfig = {
  source: { sourceId: string; startChapter: number; endChapter: number };
  sourceVersion: string;
  autoStartL1: boolean;
};

function readConfig(value: Record<string, unknown>): JobConfig {
  const source = value.source;
  if (!source || typeof source !== "object" || Array.isArray(source)
    || typeof (source as Record<string, unknown>).sourceId !== "string"
    || typeof (source as Record<string, unknown>).startChapter !== "number"
    || typeof (source as Record<string, unknown>).endChapter !== "number"
    || typeof value.sourceVersion !== "string" || typeof value.autoStartL1 !== "boolean") {
    throw new Error("Invalid import job configuration");
  }
  return { source: source as JobConfig["source"], sourceVersion: value.sourceVersion, autoStartL1: value.autoStartL1 };
}

export class LibraryImportExecutor {
  constructor(private readonly options: {
    database: DatabaseConnection;
    adapter: DifyAdapter;
    cipher: ContentCipher;
    hmacKey: Buffer;
  }) {
    if (options.hmacKey.length === 0) throw new Error("Chapter HMAC key is required");
  }

  async execute(claim: ClaimedStep): Promise<{ disposition: CompletionDisposition | "failed" }> {
    try {
      return await this.executeClaim(claim);
    } catch (error) {
      const errorCode = error instanceof DifyAdapterError ? error.code : "provider_invalid_response";
      return failImportClaim(this.options.database, claim, errorCode);
    }
  }

  private async executeClaim(claim: ClaimedStep): Promise<{ disposition: CompletionDisposition }> {
    const context = await this.options.database.selectFrom("jobs")
      .innerJoin("job_steps", "job_steps.job_id", "jobs.id")
      .select(["jobs.type", "jobs.scope", "jobs.config_snapshot", "job_steps.position"])
      .where("jobs.id", "=", claim.jobId).where("job_steps.id", "=", claim.stepId).executeTakeFirstOrThrow();
    if (context.type !== "import") throw new Error("LibraryImportExecutor only accepts import jobs");
    const bookId = context.scope.bookId;
    if (typeof bookId !== "string") throw new Error("Invalid import job scope");
    const config = readConfig(context.config_snapshot);
    const sourceBookId = Number(config.source.sourceId);
    if (!Number.isSafeInteger(sourceBookId) || sourceBookId <= 0) throw new Error("Invalid import source configuration");
    const existing = await this.options.database.selectFrom("chapters").select(["id", "source_version"])
      .where("book_id", "=", bookId).where("chapter_index", "=", context.position).executeTakeFirst();
    if (existing?.source_version === config.sourceVersion) {
      return this.commit(claim, { chapterId: existing.id, chapterIndex: context.position }, true);
    }

    const raw = await this.options.adapter.runChapterImport({
      invocationKey: claim.stepId,
      bookId: sourceBookId,
      startChapter: context.position,
      endChapter: context.position,
    });
    const parsed = ChapterImportOutputSchema.safeParse(raw);
    const chapter = parsed.success && parsed.data.chapters.length === 1 ? parsed.data.chapters[0] : undefined;
    if (!chapter || chapter.chapter_index !== context.position || chapter.book_id !== config.source.sourceId) {
      throw new Error("Invalid chapter import output");
    }
    const contentHmac = createHmac("sha256", this.options.hmacKey).update(chapter.content).digest("hex");
    return this.options.database.transaction().execute(async (transaction) => {
      const disposition = await validateImportClaim(transaction, claim);
      if (disposition) return { disposition };
      const lockedBook = await transaction.selectFrom("books").select("id").where("id", "=", bookId).forUpdate().executeTakeFirst();
      if (!lockedBook) return { disposition: "terminal-noop" as const };
      const current = await transaction.selectFrom("chapters").select(["id", "source_version"]).where("book_id", "=", bookId).where("chapter_index", "=", context.position).forUpdate().executeTakeFirst();
      if (current?.source_version === config.sourceVersion) {
        return this.finish(transaction, claim, { chapterId: current.id, chapterIndex: context.position }, true, config.autoStartL1, bookId);
      }
      let chapterId: string;
      if (current) {
        const encrypted = this.options.cipher.encrypt(chapter.content);
        await transaction.updateTable("chapters").set({ title: chapter.chapter_title, content_hmac: contentHmac, content_ciphertext: encrypted.ciphertext, content_nonce: encrypted.nonce, content_tag: encrypted.tag, content_key_version: encrypted.keyVersion, source_version: config.sourceVersion, updated_at: new Date() }).where("id", "=", current.id).execute();
        await transaction.updateTable("l1_indexes").set({ status: "stale" }).where("chapter_id", "=", current.id).where("is_current", "=", true).execute();
        await transaction.updateTable("l2_chapter_statuses").set({ status: "stale", failure_code: null, updated_at: new Date() }).where("chapter_id", "=", current.id).execute();
        chapterId = current.id;
      } else {
        const inserted = await createLibraryRepository(transaction, this.options.cipher).insertChapter({ bookId, chapterIndex: chapter.chapter_index, title: chapter.chapter_title, plaintext: chapter.content, contentHmac, sourceVersion: config.sourceVersion });
        chapterId = inserted.id;
      }
      return this.finish(transaction, claim, { chapterId, chapterIndex: chapter.chapter_index }, false, config.autoStartL1, bookId);
    });
  }

  private commit(claim: ClaimedStep, output: { chapterId: string; chapterIndex: number }, skipped: boolean) {
    return this.options.database.transaction().execute(async (transaction) => {
      const disposition = await validateImportClaim(transaction, claim);
      if (disposition) return { disposition };
      const job = await transaction.selectFrom("jobs").select(["config_snapshot", "scope"]).where("id", "=", claim.jobId).executeTakeFirstOrThrow();
      const config = readConfig(job.config_snapshot);
      return this.finish(transaction, claim, output, skipped, config.autoStartL1, String(job.scope.bookId));
    });
  }

  private async finish(transaction: Transaction<Database>, claim: ClaimedStep, output: { chapterId: string; chapterIndex: number }, skipped: boolean, autoStartL1: boolean, bookId: string) {
    const job = await transaction.selectFrom("jobs").select(["status", "progress", "requested_by"]).where("id", "=", claim.jobId).executeTakeFirstOrThrow();
    await transaction.updateTable("job_steps").set({ status: "completed", output_ref: output, lease_owner: null, lease_expires_at: null, updated_at: new Date() }).where("id", "=", claim.stepId).execute();
    await transaction.updateTable("job_attempts").set({ status: "completed", finished_at: new Date() }).where("id", "=", claim.attemptId).execute();
    const progress: Record<string, unknown> = { ...job.progress, current: "chapter-import" };
    if (skipped) progress.skipped = Number(progress.skipped ?? 0) + 1;
    else progress.completed = Number(progress.completed ?? 0) + 1;
    await transaction.updateTable("jobs").set({ progress, updated_at: new Date() }).where("id", "=", claim.jobId).execute();
    await transaction.insertInto("job_events").values({ job_id: claim.jobId, type: "progress", dedupe_key: `step:${claim.stepId}:completed`, payload: { stepId: claim.stepId, position: claim.position, progress } }).onConflict((conflict) => conflict.columns(["job_id", "dedupe_key"]).doNothing()).execute();
    if (job.status === "paused") return { disposition: "paused-boundary" as const };
    const remaining = await transaction.selectFrom("job_steps").select("id").where("job_id", "=", claim.jobId).where("status", "!=", "completed").executeTakeFirst();
    if (remaining) {
      await transaction.insertInto("job_outbox").values({ job_id: claim.jobId, topic: "jobs.wake", payload: { jobId: claim.jobId }, claimed_by: null, claim_expires_at: null, delivered_at: null }).execute();
      return { disposition: "completed" as const };
    }
    await transaction.updateTable("jobs").set({ status: "completed", updated_at: new Date() }).where("id", "=", claim.jobId).execute();
    await transaction.insertInto("job_events").values({ job_id: claim.jobId, type: "completed", dedupe_key: "completed", payload: { status: "completed", progress } }).onConflict((conflict) => conflict.columns(["job_id", "dedupe_key"]).doNothing()).execute();
    if (autoStartL1) await createImportL1Handoff(transaction, { importJobId: claim.jobId, bookId, requestedBy: job.requested_by });
    return { disposition: "completed" as const };
  }
}

async function validateImportClaim(transaction: Transaction<Database>, claim: ClaimedStep): Promise<CompletionDisposition | null> {
  const job = await transaction.selectFrom("jobs").select("status").where("id", "=", claim.jobId).forUpdate().executeTakeFirst();
  if (!job) return "terminal-noop";
  const step = await transaction.selectFrom("job_steps").selectAll().where("id", "=", claim.stepId).where("job_id", "=", claim.jobId).forUpdate().executeTakeFirst();
  if (!step) return "terminal-noop";
  if (step.status === "completed") return "already-completed";
  if (job.status === "cancelled") return "discarded-cancelled";
  if (job.status === "completed" || job.status === "failed") return "terminal-noop";
  const now = (await sql<{ now: Date }>`select clock_timestamp() as now`.execute(transaction)).rows[0]!.now;
  if (step.status !== "running" || step.lease_owner !== claim.workerId || step.attempt_count !== claim.attemptNo
    || step.lease_expires_at?.getTime() !== claim.leaseExpiresAt.getTime() || step.lease_expires_at.getTime() <= now.getTime()) return "terminal-noop";
  const attempt = await transaction.selectFrom("job_attempts").selectAll().where("id", "=", claim.attemptId).forUpdate().executeTakeFirst();
  if (!attempt || attempt.step_id !== claim.stepId || attempt.attempt_no !== claim.attemptNo || attempt.worker_id !== claim.workerId || attempt.status !== "running") return "terminal-noop";
  return null;
}

export function failImportClaim(database: DatabaseConnection, claim: ClaimedStep, errorCode: string): Promise<{ disposition: CompletionDisposition | "failed" }> {
  return database.transaction().execute(async (transaction) => {
    const disposition = await validateImportClaim(transaction, claim);
    if (disposition) return { disposition };
    const job = await transaction.selectFrom("jobs").select("progress").where("id", "=", claim.jobId).executeTakeFirstOrThrow();
    const progress: Record<string, unknown> = { ...job.progress, failed: Number(job.progress.failed ?? 0) + 1, current: "chapter-import" };
    await transaction.updateTable("job_attempts").set({ status: "failed", error_code: errorCode, error_message: errorCode, finished_at: new Date() }).where("id", "=", claim.attemptId).execute();
    await transaction.updateTable("job_steps").set({ status: "failed", lease_owner: null, lease_expires_at: null, updated_at: new Date() }).where("id", "=", claim.stepId).execute();
    await transaction.updateTable("jobs").set({ status: "failed", progress, updated_at: new Date() }).where("id", "=", claim.jobId).execute();
    await transaction.insertInto("job_events").values({ job_id: claim.jobId, type: "failed", dedupe_key: `step:${claim.stepId}:failed`, payload: { stepId: claim.stepId, position: claim.position, errorCode, progress } }).onConflict((conflict) => conflict.columns(["job_id", "dedupe_key"]).doNothing()).execute();
    return { disposition: "failed" };
  });
}
