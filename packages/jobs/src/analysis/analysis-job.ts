import { createHash } from "node:crypto";
import { sql } from "kysely";

import { AdvancedAnalysisExecutionConfigSchema, AdvancedAnalysisExecutionSnapshotSchema, type AdvancedAnalysisExecutionConfig, type AdvancedAnalysisExecutionSnapshot, type AnalysisExecutionVersions, type AnalysisMode, type AnalysisRunSummary, type AnalysisScopePreview, type AnalysisSourceSummary, type PublicJob } from "@novel-analysis/contracts";
import { createAnalysisRepository, type AnalysisActor, type ContentCipher, type DatabaseConnection, type DatabaseExecutor, type FactRetrievalMetadata } from "@novel-analysis/database";
import { modeSourcePolicy } from "@novel-analysis/domain";

import { jobRowToPublic, PUBLIC_JOB_COLUMNS } from "../job-repository.js";
import { L1_ROUTE_SCHEMA_VERSION } from "../library/l1-job.js";
import { L2_ADMISSION_VERSION, L2_FACT_SCHEMA_VERSION } from "../library/l2-job.js";

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
  templateContentHash: string;
  indexGroup: { id: string; key: string; name: string; categoryScope: "general" | "magical_creature"; configHash: string; promptVersionId: string } | null;
  chapters: Array<{
    id: string; chapterIndex: number; contentHmac: string; sourceVersion: string;
    l1: { id: string; promptVersionId: string; workflowVersionId: string; inputSignature: string; status: "fresh" | "failed" | "stale" } | null;
    l2: { inputSignature: string; status: "fresh" | "failed" | "stale"; facts: Array<{ id: string; subjectKey: string; factType: string; payload: string; metadata: FactRetrievalMetadata }> } | null;
  }>;
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
  private readonly executionConfig: AdvancedAnalysisExecutionConfig;

  constructor(private readonly database: DatabaseConnection, private readonly cipher: ContentCipher, executionConfig?: unknown) {
    this.executionConfig = AdvancedAnalysisExecutionConfigSchema.parse(executionConfig);
  }

  private async select(input: AnalysisPreviewInput, executor: DatabaseExecutor = this.database): Promise<Selection> {
    if (input.actor.role === "admin" || !Number.isSafeInteger(input.startChapter) || !Number.isSafeInteger(input.endChapter) || input.startChapter < 1 || input.endChapter < input.startChapter) throw new AnalysisNotFoundError();
    const template = await executor.selectFrom("analysis_templates as t")
      .innerJoin("analysis_template_versions as v", "v.id", "t.current_version_id")
      .innerJoin("books as b", "b.id", "t.book_id")
      .leftJoin("index_groups as g", "g.id", "t.index_group_id")
      .select(["t.id", "t.book_id", "t.index_group_id", "v.id as version_id", "v.content_hash", "b.status as book_status", "g.status as group_status", "g.key as group_key", "g.name as group_name", "g.category_scope", "g.config_hash", "g.prompt_version_id"])
      .where("t.id", "=", input.templateId).where("t.book_id", "=", input.bookId).where("t.created_by", "=", input.actor.id).executeTakeFirst();
    if (!template || template.book_status !== "active" || (input.mode !== "full_text" && (!template.index_group_id || template.group_status !== "active"))) throw new AnalysisNotFoundError();
    const workflow = await executor.selectFrom("workflow_versions").select(["id", "contract_version", "dsl_hash"]).where("target", "=", "analysis-summary").where("enabled", "=", true).orderBy("created_at", "desc").orderBy("id", "desc").executeTakeFirst();
    if (!workflow) throw new AnalysisInvalidRequestError();
    const chapterRows = await executor.selectFrom("chapters as c")
      .leftJoin("l1_indexes as l1", (join) => join.onRef("l1.chapter_id", "=", "c.id").on("l1.is_current", "=", true))
      .leftJoin("l2_chapter_statuses as l2", (join) => join.onRef("l2.chapter_id", "=", "c.id").on("l2.group_id", "=", template.index_group_id))
      .select(["c.id", "c.chapter_index", "c.content_hmac", "c.source_version", "l1.id as l1_id", "l1.prompt_version_id as l1_prompt_version_id", "l1.workflow_version_id as l1_workflow_version_id", "l1.input_signature as l1_input_signature", "l1.status as l1_status", "l2.input_signature as l2_input_signature", "l2.status as l2_status"])
      .where("c.book_id", "=", input.bookId).where("c.chapter_index", ">=", input.startChapter).where("c.chapter_index", "<=", input.endChapter).orderBy("c.chapter_index").execute();
    let chapters = chapterRows.map((row) => ({ id: row.id, chapterIndex: row.chapter_index, contentHmac: row.content_hmac, sourceVersion: row.source_version, l1: row.l1_id ? { id: row.l1_id, promptVersionId: row.l1_prompt_version_id!, workflowVersionId: row.l1_workflow_version_id!, inputSignature: row.l1_input_signature!, status: row.l1_status! } : null, l2: row.l2_input_signature ? { inputSignature: row.l2_input_signature, status: row.l2_status!, facts: [] as Array<{ id: string; subjectKey: string; factType: string; payload: string; metadata: FactRetrievalMetadata }> } : null }));
    if (chapters.length !== input.endChapter - input.startChapter + 1) throw new AnalysisInvalidRequestError();
    const policy = modeSourcePolicy(input.mode, chapters.length);
    if (policy.readsL2 && template.index_group_id) {
      const facts = await executor.selectFrom("l2_facts").select(["id", "chapter_id", "subject_key", "fact_type", "fact_ciphertext", "fact_nonce", "fact_tag", "fact_key_version", "metadata"]).where("group_id", "=", template.index_group_id).where("chapter_id", "in", chapters.map((chapter) => chapter.id)).orderBy("chapter_id").orderBy("id").execute();
      const byChapter = new Map<string, Array<{ id: string; subjectKey: string; factType: string; payload: string; metadata: FactRetrievalMetadata }>>();
      for (const fact of facts) {
        const list = byChapter.get(fact.chapter_id) ?? [];
        list.push({ id: fact.id, subjectKey: fact.subject_key, factType: fact.fact_type, payload: this.cipher.decrypt({ ciphertext: fact.fact_ciphertext, nonce: fact.fact_nonce, tag: fact.fact_tag, keyVersion: fact.fact_key_version }), metadata: fact.metadata });
        byChapter.set(fact.chapter_id, list);
      }
      chapters = chapters.map((chapter) => chapter.l2 ? { ...chapter, l2: { ...chapter.l2, facts: byChapter.get(chapter.id) ?? [] } } : chapter);
    }
    const executionVersions: AnalysisExecutionVersions = { workflow: { target: "analysis-summary", id: workflow.id, contractVersion: workflow.contract_version, dslHash: workflow.dsl_hash }, ...this.executionConfig, l1SchemaVersion: L1_ROUTE_SCHEMA_VERSION, l2SchemaVersion: L2_FACT_SCHEMA_VERSION, l2AdmissionVersion: L2_ADMISSION_VERSION };
    const sourceSummary: AnalysisSourceSummary = { indexGroupId: template.index_group_id, indexGroupConfigHash: template.config_hash ?? null, chapterSourceVersions: [...new Set(chapters.map((chapter) => chapter.sourceVersion))], l1: { selectedCount: policy.readsL1 ? chapters.length : 0, freshCount: policy.readsL1 ? chapters.filter((chapter) => chapter.l1?.status === "fresh").length : 0 }, l2: { selectedCount: policy.readsL2 ? chapters.length : 0, freshCount: policy.readsL2 ? chapters.filter((chapter) => chapter.l2?.status === "fresh").length : 0 }, readsL1: policy.readsL1, readsL2: policy.readsL2, readsOriginalChapters: policy.readsOriginalChapters, reviewedChapterBoundary: policy.reviewChapterCount === 0 ? null : { startChapter: input.startChapter, endChapter: input.endChapter, maximumChapterCount: policy.reviewChapterCount } };
    const indexGroup = template.index_group_id ? { id: template.index_group_id, key: template.group_key!, name: template.group_name!, categoryScope: template.category_scope!, configHash: template.config_hash!, promptVersionId: template.prompt_version_id! } : null;
    const scopeHash = hash({ bookId: input.bookId, template: { id: template.id, versionId: template.version_id, contentHash: template.content_hash }, indexGroup, mode: input.mode, range: [input.startChapter, input.endChapter], chapters, executionVersions, sourceSummary });
    return { bookId: input.bookId, templateId: template.id, templateVersionId: template.version_id, templateContentHash: template.content_hash, indexGroup, mode: input.mode, startChapter: input.startChapter, endChapter: input.endChapter, chapterCount: chapters.length, ...policy, executionVersions, sourceSummary, scopeHash, chapters };
  }

  async preview(input: AnalysisPreviewInput): Promise<AnalysisScopePreview> {
    const selection = await this.select(input);
    return { bookId: selection.bookId, templateVersionId: selection.templateVersionId, mode: selection.mode, startChapter: selection.startChapter, endChapter: selection.endChapter, chapterCount: selection.chapterCount, reviewChapterCount: selection.reviewChapterCount, readsL1: selection.readsL1, readsL2: selection.readsL2, readsOriginalChapters: selection.readsOriginalChapters, executionVersions: selection.executionVersions, sourceSummary: selection.sourceSummary, scopeHash: selection.scopeHash };
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
      const executionSnapshot: AdvancedAnalysisExecutionSnapshot = AdvancedAnalysisExecutionSnapshotSchema.parse({ bookId: input.bookId, scopeHash: selection.scopeHash, template: { id: selection.templateId, versionId: selection.templateVersionId, contentHash: selection.templateContentHash }, mode: selection.mode, range: { startChapter: selection.startChapter, endChapter: selection.endChapter }, indexGroup: selection.indexGroup, executionVersions: selection.executionVersions, sourcePolicy: selection.sourceSummary, chapters: selection.chapters.map((chapter) => ({ id: chapter.id, position: chapter.chapterIndex, contentHmac: chapter.contentHmac, sourceVersion: chapter.sourceVersion, l1: chapter.l1, l2: chapter.l2 })) });
      const inserted = await transaction.insertInto("jobs").values({ type: "advanced-analysis", status: "queued", requested_by: input.actor.id, request_id: input.requestId, scope: { bookId: input.bookId, startChapter: input.startChapter, endChapter: input.endChapter }, config_snapshot: { operation: "create-analysis", requestFingerprint: fingerprint, scopeHash: selection.scopeHash, snapshotStored: true }, concurrency_key: `advanced-analysis:${input.actor.id}:${input.requestId}`, progress: { total: selection.chapterCount, completed: 0, failed: 0, skipped: 0, current: "" } }).returning(PUBLIC_JOB_COLUMNS).executeTakeFirstOrThrow();
      const job = jobRowToPublic(inserted);
      const repository = createAnalysisRepository(transaction, this.cipher);
      const runRow = await repository.createRun({ bookId: input.bookId, createdBy: input.actor.id, templateVersionId: selection.templateVersionId, jobId: job.id, mode: input.mode, startChapter: input.startChapter, endChapter: input.endChapter, status: "queued", executionSignature: selection.scopeHash, totalParts: selection.chapterCount, executionSnapshot, executionSnapshotSchema: AdvancedAnalysisExecutionSnapshotSchema });
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
