import { createHash } from "node:crypto";
import { sql } from "kysely";

import type { AnalysisMode, AnalysisRunSummary, AnalysisScopePreview, PublicJob } from "@novel-analysis/contracts";
import { createAnalysisRepository, type AnalysisActor, type ContentCipher, type DatabaseConnection, type DatabaseExecutor } from "@novel-analysis/database";
import { modeSourcePolicy } from "@novel-analysis/domain";

import { jobRowToPublic, PUBLIC_JOB_COLUMNS } from "../job-repository.js";

export class AnalysisNotFoundError extends Error {}
export class AnalysisInvalidRequestError extends Error {}
export class AnalysisScopeChangedError extends Error {}
export class AnalysisIdempotencyConflictError extends Error {}
export class AnalysisInvalidStateError extends Error {}

export interface AnalysisPreviewInput {
  bookId: string;
  templateId: string;
  actor: AnalysisActor;
  mode: AnalysisMode;
  startChapter: number;
  endChapter: number;
}

export type AnalysisCreateInput = AnalysisPreviewInput & {
  templateVersionId: string;
  scopeHash: string;
  requestId: string;
};

type Selection = AnalysisScopePreview & {
  templateId: string;
  indexGroupId: string | null;
  templateContentHash: string;
  workflow: { id: string; contractVersion: string; dslHash: string };
  chapters: Array<{ id: string; chapterIndex: number; contentHmac: string; sourceVersion: string }>;
};

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const requestLock = (ownerId: string, requestId: string) => `${ownerId}:advanced-analysis:${requestId}`;

function runToPublic(row: {
  id: string; book_id: string; template_version_id: string; job_id: string; mode: AnalysisMode;
  start_chapter: number; end_chapter: number; status: AnalysisRunSummary["status"];
  completed_parts: number; total_parts: number; created_at: Date; updated_at: Date;
}): AnalysisRunSummary {
  return { id: row.id, bookId: row.book_id, templateVersionId: row.template_version_id, jobId: row.job_id, mode: row.mode, startChapter: row.start_chapter, endChapter: row.end_chapter, status: row.status, completedParts: row.completed_parts, totalParts: row.total_parts, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}

export class AnalysisJobService {
  constructor(private readonly database: DatabaseConnection, private readonly cipher: ContentCipher) {}

  private async select(input: AnalysisPreviewInput, executor: DatabaseExecutor = this.database): Promise<Selection> {
    if (input.actor.role === "admin" || !Number.isSafeInteger(input.startChapter) || !Number.isSafeInteger(input.endChapter) || input.startChapter < 1 || input.endChapter < input.startChapter) throw new AnalysisNotFoundError();
    const template = await executor.selectFrom("analysis_templates as t")
      .innerJoin("analysis_template_versions as v", "v.id", "t.current_version_id")
      .innerJoin("books as b", "b.id", "t.book_id")
      .leftJoin("index_groups as g", "g.id", "t.index_group_id")
      .select(["t.id", "t.book_id", "t.index_group_id", "v.id as version_id", "v.content_hash", "b.status as book_status", "g.status as group_status", "g.config_hash"])
      .where("t.id", "=", input.templateId).where("t.book_id", "=", input.bookId).where("t.created_by", "=", input.actor.id).executeTakeFirst();
    if (!template || template.book_status !== "active" || (input.mode !== "full_text" && (!template.index_group_id || template.group_status !== "active"))) throw new AnalysisNotFoundError();
    const workflow = await executor.selectFrom("workflow_versions").select(["id", "contract_version", "dsl_hash"]).where("target", "=", "analysis-summary").where("enabled", "=", true).orderBy("created_at", "desc").orderBy("id", "desc").executeTakeFirst();
    if (!workflow) throw new AnalysisInvalidRequestError();
    const chapters = await executor.selectFrom("chapters").select(["id", "chapter_index", "content_hmac", "source_version"]).where("book_id", "=", input.bookId).where("chapter_index", ">=", input.startChapter).where("chapter_index", "<=", input.endChapter).orderBy("chapter_index").execute();
    if (chapters.length !== input.endChapter - input.startChapter + 1) throw new AnalysisInvalidRequestError();
    const policy = modeSourcePolicy(input.mode, chapters.length);
    const scopeHash = hash({ bookId: input.bookId, templateVersionId: template.version_id, templateContentHash: template.content_hash, indexGroupId: template.index_group_id, indexConfigHash: template.config_hash, mode: input.mode, range: [input.startChapter, input.endChapter], chapters: chapters.map((row) => ({ id: row.id, chapterIndex: row.chapter_index, contentHmac: row.content_hmac, sourceVersion: row.source_version })), workflow: { id: workflow.id, contractVersion: workflow.contract_version, dslHash: workflow.dsl_hash }, policy });
    return { bookId: input.bookId, templateId: template.id, templateVersionId: template.version_id, templateContentHash: template.content_hash, indexGroupId: template.index_group_id, mode: input.mode, startChapter: input.startChapter, endChapter: input.endChapter, chapterCount: chapters.length, ...policy, scopeHash, workflow: { id: workflow.id, contractVersion: workflow.contract_version, dslHash: workflow.dsl_hash }, chapters: chapters.map((row) => ({ id: row.id, chapterIndex: row.chapter_index, contentHmac: row.content_hmac, sourceVersion: row.source_version })) };
  }

  async preview(input: AnalysisPreviewInput): Promise<AnalysisScopePreview> {
    const selection = await this.select(input);
    return { bookId: selection.bookId, templateVersionId: selection.templateVersionId, mode: selection.mode, startChapter: selection.startChapter, endChapter: selection.endChapter, chapterCount: selection.chapterCount, reviewChapterCount: selection.reviewChapterCount, readsL1: selection.readsL1, readsL2: selection.readsL2, readsOriginalChapters: selection.readsOriginalChapters, scopeHash: selection.scopeHash };
  }

  async create(input: AnalysisCreateInput): Promise<{ run: AnalysisRunSummary; job: PublicJob }> {
    return this.database.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(hashtext(${requestLock(input.actor.id, input.requestId)}))`.execute(transaction);
      const fingerprint = hash({ operation: "create-analysis", bookId: input.bookId, templateId: input.templateId, templateVersionId: input.templateVersionId, mode: input.mode, startChapter: input.startChapter, endChapter: input.endChapter, scopeHash: input.scopeHash });
      const existing = await transaction.selectFrom("jobs").select([...PUBLIC_JOB_COLUMNS, "config_snapshot"]).where("requested_by", "=", input.actor.id).where("request_id", "=", input.requestId).executeTakeFirst();
      if (existing) {
        if (existing.type !== "advanced-analysis" || existing.config_snapshot.requestFingerprint !== fingerprint) throw new AnalysisIdempotencyConflictError();
        const run = await transaction.selectFrom("analysis_runs").selectAll().where("job_id", "=", existing.id).where("created_by", "=", input.actor.id).executeTakeFirstOrThrow();
        return { run: runToPublic(run), job: jobRowToPublic(existing) };
      }
      const selection = await this.select(input, transaction);
      if (selection.templateVersionId !== input.templateVersionId || selection.scopeHash !== input.scopeHash) throw new AnalysisScopeChangedError();
      const inserted = await transaction.insertInto("jobs").values({ type: "advanced-analysis", status: "queued", requested_by: input.actor.id, request_id: input.requestId, scope: { bookId: input.bookId, startChapter: input.startChapter, endChapter: input.endChapter }, config_snapshot: { operation: "create-analysis", mode: input.mode, requestFingerprint: fingerprint, scopeHash: selection.scopeHash, templateVersionId: selection.templateVersionId, templateContentHash: selection.templateContentHash, indexGroupId: selection.indexGroupId, workflow: selection.workflow }, concurrency_key: `advanced-analysis:${input.actor.id}:${input.requestId}`, progress: { total: selection.chapterCount, completed: 0, failed: 0, skipped: 0, current: "" } }).returning(PUBLIC_JOB_COLUMNS).executeTakeFirstOrThrow();
      const job = jobRowToPublic(inserted);
      const repository = createAnalysisRepository(transaction, this.cipher);
      const runRow = await repository.createRun({ bookId: input.bookId, createdBy: input.actor.id, templateVersionId: selection.templateVersionId, jobId: job.id, mode: input.mode, startChapter: input.startChapter, endChapter: input.endChapter, status: "queued", executionSignature: selection.scopeHash, totalParts: selection.chapterCount });
      for (const chapter of selection.chapters) {
        const signature = hash({ scopeHash: selection.scopeHash, chapterId: chapter.id, chapterIndex: chapter.chapterIndex, contentHmac: chapter.contentHmac, sourceVersion: chapter.sourceVersion });
        await repository.createPart({ runId: runRow.id, position: chapter.chapterIndex, kind: "analysis-part", status: "queued", inputSignature: signature });
      }
      await transaction.insertInto("job_steps").values({ job_id: job.id, position: 1, kind: "advanced-analysis", status: "queued", input_signature: selection.scopeHash, idempotency_key: `${job.id}:advanced-analysis`, output_ref: { runId: runRow.id }, lease_owner: null, lease_expires_at: null }).execute();
      await transaction.insertInto("job_events").values({ job_id: job.id, type: "created", dedupe_key: "created", payload: { status: "queued" } }).execute();
      await transaction.insertInto("job_outbox").values({ job_id: job.id, topic: "jobs.advanced-analysis.wake", payload: { jobId: job.id }, claimed_by: null, claim_expires_at: null, delivered_at: null }).execute();
      await transaction.insertInto("audit_logs").values({ actor_user_id: input.actor.id, action: "advanced_analysis.created", target_type: "analysis_run", target_id: runRow.id, metadata: { requestId: input.requestId, requestFingerprint: fingerprint, jobId: job.id, bookId: input.bookId } }).execute();
      return { run: runToPublic(runRow), job };
    });
  }

  async hardDelete(input: { runId: string; actor: AnalysisActor }): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      if (input.actor.role === "admin") throw new AnalysisNotFoundError();
      const run = await transaction.selectFrom("analysis_runs").selectAll().where("id", "=", input.runId).where("created_by", "=", input.actor.id).forUpdate().executeTakeFirst();
      if (!run) throw new AnalysisNotFoundError();
      const job = await transaction.selectFrom("jobs").selectAll().where("id", "=", run.job_id).where("requested_by", "=", input.actor.id).where("type", "=", "advanced-analysis").forUpdate().executeTakeFirst();
      if (!job) throw new AnalysisNotFoundError();
      const terminal = new Set(["completed", "failed", "cancelled"]);
      if (!terminal.has(run.status) || !terminal.has(job.status) || run.status !== job.status) throw new AnalysisInvalidStateError();
      await transaction.insertInto("audit_logs").values({ actor_user_id: input.actor.id, action: "advanced_analysis.deleted", target_type: "analysis_run", target_id: run.id, metadata: { bookId: run.book_id, jobId: job.id, status: run.status } }).execute();
      const steps = transaction.selectFrom("job_steps").select("id").where("job_id", "=", job.id);
      await transaction.deleteFrom("job_attempts").where("step_id", "in", steps).execute();
      await transaction.deleteFrom("job_steps").where("job_id", "=", job.id).execute();
      await transaction.deleteFrom("job_events").where("job_id", "=", job.id).execute();
      await transaction.deleteFrom("job_outbox").where("job_id", "=", job.id).execute();
      await transaction.deleteFrom("analysis_parts").where("run_id", "=", run.id).execute();
      await transaction.deleteFrom("analysis_runs").where("id", "=", run.id).execute();
      await transaction.deleteFrom("jobs").where("id", "=", job.id).execute();
    });
  }
}
