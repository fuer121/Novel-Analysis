import { createHash, createHmac } from "node:crypto";
import { sql } from "kysely";

import type { PublicJob } from "@novel-analysis/contracts";
import { createQueryRepository, type ContentCipher, type DatabaseConnection, type DatabaseExecutor, type QueryActor, type QuerySession, type QueryTurn, type QueryTurnDetail } from "@novel-analysis/database";

import { jobRowToPublic, PUBLIC_JOB_COLUMNS } from "../job-repository.js";

export class QueryNotFoundError extends Error {}
export class QueryAccessDeniedError extends Error {}
export class QueryInvalidRequestError extends Error {}
export class QueryConfigurationError extends Error {}
export class QueryScopeChangedError extends Error {}
export class QueryIdempotencyConflictError extends Error {}
export class QueryInvalidStateError extends Error {}

export interface QueryPreviewInput {
  bookId: string;
  sessionId: string;
  actor: QueryActor;
  question: string;
  startChapter?: number;
  endChapter?: number;
}

export interface QueryPreview {
  book: { id: string; title: string };
  group: { id: string; key: string; name: string };
  defaultRange: { startChapter: number; endChapter: number };
  effectiveRange: { startChapter: number; endChapter: number };
  queryableChapterCount: number;
  coverageGaps: number[];
  executionVersions: { summaryWorkflowVersion: string; recallPolicyVersion: string };
  estimatedQueuePosition: number;
  scopeHash: string;
}

export type QueryCreateInput = QueryPreviewInput & { requestId: string; scopeHash: string };
export type QueryFallbackInput = { bookId: string; sessionId: string; turnId: string; actor: QueryActor; requestId: string };

type Selection = QueryPreview & {
  session: QuerySession;
  questionHmac: string;
  recentQuestionHmacs: string[];
  coverageSignatures: Array<{ chapterIndex: number; status: string; inputSignature: string | null }>;
  summaryWorkflow: { id: string; contractVersion: string; dslHash: string };
};

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function actorCanManageTurn(turn: QueryTurn, actor: QueryActor): boolean {
  return actor.role === "admin" || turn.createdBy === actor.id;
}

function mapRepositoryError(error: unknown): never {
  if (error instanceof Error && error.message === "Query access denied") throw new QueryAccessDeniedError();
  if (error instanceof Error && error.message.startsWith("Invalid query")) throw new QueryInvalidRequestError();
  throw error;
}

export class QueryJobService {
  constructor(
    private readonly database: DatabaseConnection,
    private readonly cipher: ContentCipher,
    private readonly options: { hmacKey: Buffer; recallPolicyVersion: string },
  ) {
    if (options.hmacKey.length === 0 || !options.recallPolicyVersion) throw new QueryConfigurationError();
  }

  private async select(input: QueryPreviewInput, executor: DatabaseExecutor = this.database): Promise<Selection> {
    if (!input.question.trim()) throw new QueryInvalidRequestError();
    const repository = createQueryRepository(executor, this.cipher);
    let sessions: QuerySession[];
    try { sessions = await repository.listVisibleSessions({ bookId: input.bookId, actor: input.actor }); }
    catch (error) { mapRepositoryError(error); }
    const session = sessions.find((candidate) => candidate.id === input.sessionId);
    if (!session) throw new QueryNotFoundError();
    if (session.archivedAt) throw new QueryInvalidStateError();
    const startChapter = input.startChapter ?? session.defaultStartChapter;
    const endChapter = input.endChapter ?? session.defaultEndChapter;
    if (!Number.isSafeInteger(startChapter) || !Number.isSafeInteger(endChapter) || startChapter < session.defaultStartChapter || endChapter > session.defaultEndChapter || endChapter < startChapter) throw new QueryInvalidRequestError();

    const context = await executor.selectFrom("query_sessions as s")
      .innerJoin("books as b", "b.id", "s.book_id")
      .innerJoin("index_groups as g", "g.id", "s.group_id")
      .select(["b.id as book_id", "b.title as book_title", "b.status as book_status", "g.id as group_id", "g.key as group_key", "g.name as group_name", "g.status as group_status"])
      .where("s.id", "=", session.id).where("s.book_id", "=", input.bookId).executeTakeFirst();
    if (!context || context.book_status !== "active" || context.group_status !== "active") throw new QueryNotFoundError();
    const workflow = await executor.selectFrom("workflow_versions").select(["id", "contract_version", "dsl_hash"]).where("target", "=", "analysis-summary").where("enabled", "=", true).orderBy("created_at", "desc").orderBy("id", "desc").executeTakeFirst();
    if (!workflow) throw new QueryConfigurationError();
    const coverage = await executor.selectFrom("chapters as c").leftJoin("l2_chapter_statuses as s", (join) => join.onRef("s.chapter_id", "=", "c.id").on("s.group_id", "=", session.groupId))
      .select(["c.chapter_index", "s.status", "s.input_signature"]).where("c.book_id", "=", input.bookId).where("c.chapter_index", ">=", startChapter).where("c.chapter_index", "<=", endChapter).orderBy("c.chapter_index").execute();
    const recentQuestionHmacs = (await executor.selectFrom("query_turns").select("question_hmac").where("session_id", "=", session.id).orderBy("created_at", "desc").orderBy("id", "desc").limit(3).execute()).reverse().map((row) => row.question_hmac);
    const coverageSignatures = coverage.map((row) => ({ chapterIndex: row.chapter_index, status: row.status ?? "missing", inputSignature: row.input_signature }));
    const questionHmac = createHmac("sha256", this.options.hmacKey).update(input.question).digest("hex");
    const scopeHash = sha256({ sessionId: session.id, groupId: session.groupId, range: [startChapter, endChapter], questionHmac, coverageSignatures, summaryWorkflow: { contractVersion: workflow.contract_version, dslHash: workflow.dsl_hash }, recallPolicyVersion: this.options.recallPolicyVersion, recentQuestionHmacs });
    const queue = await executor.selectFrom("jobs").select(({ fn }) => fn.countAll<number>().as("count")).where("type", "=", "query").where("status", "in", ["queued", "running", "retrying"]).executeTakeFirstOrThrow();
    return {
      book: { id: context.book_id, title: context.book_title }, group: { id: context.group_id, key: context.group_key, name: context.group_name },
      defaultRange: { startChapter: session.defaultStartChapter, endChapter: session.defaultEndChapter }, effectiveRange: { startChapter, endChapter },
      queryableChapterCount: coverage.filter((row) => row.status === "fresh").length, coverageGaps: coverage.filter((row) => row.status !== "fresh").map((row) => row.chapter_index),
      executionVersions: { summaryWorkflowVersion: workflow.contract_version, recallPolicyVersion: this.options.recallPolicyVersion }, estimatedQueuePosition: Number(queue.count) + 1, scopeHash,
      session, questionHmac, recentQuestionHmacs, coverageSignatures, summaryWorkflow: { id: workflow.id, contractVersion: workflow.contract_version, dslHash: workflow.dsl_hash },
    };
  }

  async preview(input: QueryPreviewInput): Promise<QueryPreview> {
    const selection = await this.select(input);
    return { book: selection.book, group: selection.group, defaultRange: selection.defaultRange, effectiveRange: selection.effectiveRange, queryableChapterCount: selection.queryableChapterCount, coverageGaps: selection.coverageGaps, executionVersions: selection.executionVersions, estimatedQueuePosition: selection.estimatedQueuePosition, scopeHash: selection.scopeHash };
  }

  async createTurn(input: QueryCreateInput): Promise<{ turn: QueryTurn; job: PublicJob }> {
    return this.database.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(hashtext(${`${input.actor.id}:query-turn:${input.requestId}`}))`.execute(transaction);
      const existing = await transaction.selectFrom("jobs").select(PUBLIC_JOB_COLUMNS).where("requested_by", "=", input.actor.id).where("request_id", "=", input.requestId).executeTakeFirst();
      if (existing) {
        const config = await transaction.selectFrom("jobs").select("config_snapshot").where("id", "=", existing.id).executeTakeFirstOrThrow();
        if (config.config_snapshot.requestFingerprint !== sha256({ sessionId: input.sessionId, question: input.question, startChapter: input.startChapter, endChapter: input.endChapter, scopeHash: input.scopeHash })) throw new QueryIdempotencyConflictError();
        const turnId = (await transaction.selectFrom("query_turns").select("id").where("job_id", "=", existing.id).executeTakeFirstOrThrow()).id;
        const turn = await createQueryRepository(transaction, this.cipher).getTurn({ turnId, actor: input.actor });
        return { turn, job: jobRowToPublic(existing) };
      }
      let selection: Selection;
      try { selection = await this.select(input, transaction); }
      catch (error) { if (error instanceof QueryInvalidRequestError) throw new QueryScopeChangedError(); throw error; }
      if (selection.scopeHash !== input.scopeHash) throw new QueryScopeChangedError();
      const requestFingerprint = sha256({ sessionId: input.sessionId, question: input.question, startChapter: input.startChapter, endChapter: input.endChapter, scopeHash: input.scopeHash });
      const inserted = await transaction.insertInto("jobs").values({ type: "query", status: "queued", requested_by: input.actor.id, request_id: input.requestId, scope: { bookId: input.bookId, startChapter: selection.effectiveRange.startChapter, endChapter: selection.effectiveRange.endChapter, indexGroupKeys: [selection.group.key] }, config_snapshot: { requestFingerprint, scopeHash: selection.scopeHash, sessionId: input.sessionId, groupId: selection.group.id, questionHmac: selection.questionHmac, recentQuestionHmacs: selection.recentQuestionHmacs, coverageSignatures: selection.coverageSignatures, summaryWorkflow: selection.summaryWorkflow, recallPolicyVersion: this.options.recallPolicyVersion }, concurrency_key: `query:${input.sessionId}:${input.requestId}`, progress: { total: 1, completed: 0, failed: 0, skipped: 0, current: "" } }).returning(PUBLIC_JOB_COLUMNS).executeTakeFirstOrThrow();
      const job = jobRowToPublic(inserted);
      const turn = await createQueryRepository(transaction, this.cipher).createTurn({ sessionId: input.sessionId, actor: input.actor, question: input.question, questionHmac: selection.questionHmac, startChapter: selection.effectiveRange.startChapter, endChapter: selection.effectiveRange.endChapter, intentSnapshot: {}, sourceSnapshot: {}, gapSnapshot: {}, configSnapshot: { recallPolicyVersion: this.options.recallPolicyVersion, summaryWorkflowVersion: selection.summaryWorkflow.contractVersion }, executionSignature: selection.scopeHash, jobId: job.id });
      await transaction.insertInto("job_steps").values({ job_id: job.id, position: 1, kind: "l2-query", status: "queued", input_signature: selection.scopeHash, idempotency_key: `${job.id}:l2-query`, output_ref: { turnId: turn.id }, lease_owner: null, lease_expires_at: null }).execute();
      await transaction.insertInto("job_events").values({ job_id: job.id, type: "created", dedupe_key: "created", payload: { status: "queued" } }).execute();
      await transaction.insertInto("job_outbox").values({ job_id: job.id, topic: "jobs.query.wake", payload: { jobId: job.id }, claimed_by: null, claim_expires_at: null, delivered_at: null }).execute();
      return { turn, job };
    }).catch((error: unknown) => {
      if ((error as { code?: string }).code === "23505") throw new QueryIdempotencyConflictError();
      throw error;
    });
  }

  private async createFallback(input: QueryFallbackInput, kind: "query-summary-retry" | "query-local-summary"): Promise<PublicJob> {
    return this.database.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(hashtext(${`${input.actor.id}:query-fallback:${input.requestId}`}))`.execute(transaction);
      let turn: QueryTurnDetail;
      try { turn = await createQueryRepository(transaction, this.cipher).getTurn({ turnId: input.turnId, actor: input.actor }); }
      catch (error) { mapRepositoryError(error); }
      if (turn.sessionId !== input.sessionId || !actorCanManageTurn(turn, input.actor)) throw new QueryAccessDeniedError();
      const session = await transaction.selectFrom("query_sessions").select(["book_id", "group_id"]).where("id", "=", input.sessionId).executeTakeFirst();
      if (!session || session.book_id !== input.bookId) throw new QueryNotFoundError();
      if (!turn.evidenceSnapshotHash || turn.status !== "awaiting_fallback") throw new QueryInvalidStateError();
      const fingerprint = sha256({ turnId: turn.id, evidenceSnapshotHash: turn.evidenceSnapshotHash, kind });
      const existing = await transaction.selectFrom("jobs").select(PUBLIC_JOB_COLUMNS).where("requested_by", "=", input.actor.id).where("request_id", "=", input.requestId).executeTakeFirst();
      if (existing) {
        const config = await transaction.selectFrom("jobs").select("config_snapshot").where("id", "=", existing.id).executeTakeFirstOrThrow();
        if (config.config_snapshot.requestFingerprint !== fingerprint) throw new QueryIdempotencyConflictError();
        return jobRowToPublic(existing);
      }
      const inserted = await transaction.insertInto("jobs").values({ type: "query", status: "queued", requested_by: input.actor.id, request_id: input.requestId, scope: { bookId: input.bookId, startChapter: turn.startChapter, endChapter: turn.endChapter }, config_snapshot: { requestFingerprint: fingerprint, originalTurnId: turn.id, evidenceSnapshotHash: turn.evidenceSnapshotHash }, concurrency_key: `query:${turn.sessionId}:${input.requestId}`, progress: { total: 1, completed: 0, failed: 0, skipped: 0, current: "" } }).returning(PUBLIC_JOB_COLUMNS).executeTakeFirstOrThrow();
      const job = jobRowToPublic(inserted);
      await transaction.insertInto("job_steps").values({ job_id: job.id, position: 1, kind, status: "queued", input_signature: fingerprint, idempotency_key: `${job.id}:${kind}`, output_ref: { turnId: turn.id, evidenceSnapshotHash: turn.evidenceSnapshotHash }, lease_owner: null, lease_expires_at: null }).execute();
      await transaction.insertInto("job_events").values({ job_id: job.id, type: "created", dedupe_key: "created", payload: { status: "queued" } }).execute();
      await transaction.insertInto("job_outbox").values({ job_id: job.id, topic: "jobs.query.wake", payload: { jobId: job.id }, claimed_by: null, claim_expires_at: null, delivered_at: null }).execute();
      return job;
    });
  }

  retrySummary(input: QueryFallbackInput): Promise<PublicJob> { return this.createFallback(input, "query-summary-retry"); }
  requestLocalSummary(input: QueryFallbackInput): Promise<PublicJob> { return this.createFallback(input, "query-local-summary"); }
}
