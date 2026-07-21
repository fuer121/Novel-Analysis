import { sql, type Transaction } from "kysely";

import {
  createIndexRepository,
  createQueryRepository,
  type ContentCipher,
  type Database,
  type DatabaseConnection,
  type QueryActor,
  type QueryTurnDetail,
} from "@novel-analysis/database";
import { DifyAdapterError, type DifyAdapter } from "@novel-analysis/dify";
import { recallFacts, resolveQueryIntent, type RecallWindow } from "@novel-analysis/domain";
import type { ClaimedStep, CompletionDisposition } from "@novel-analysis/jobs";

const DEFAULT_MAX_CANDIDATES = 100;
const DEFAULT_MAX_USED = 20;
const WINDOW_SIZE = 100;
const NO_EVIDENCE_ANSWER = "没有可用证据，无法基于当前索引回答这个问题";

type QueryContext = {
  turnId: string;
  evidenceSnapshotHash?: string;
  config: Record<string, unknown>;
};

function sourceSnapshot(detail: { candidates: number; used: number; gaps: number }) {
  return { candidates: detail.candidates, used: detail.used, excluded: detail.candidates - detail.used, gaps: detail.gaps };
}

function limits(config: Record<string, unknown>): { maxCandidates: number; maxUsed: number } {
  const maxCandidates = Number(config.maxCandidates ?? DEFAULT_MAX_CANDIDATES);
  const maxUsed = Number(config.maxUsed ?? DEFAULT_MAX_USED);
  if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1 || !Number.isSafeInteger(maxUsed) || maxUsed < 1) throw new Error("Invalid query configuration");
  return { maxCandidates, maxUsed };
}

async function validateClaim(transaction: Transaction<Database>, claim: ClaimedStep): Promise<CompletionDisposition | null> {
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

async function finishClaim(transaction: Transaction<Database>, claim: ClaimedStep, output: Record<string, unknown>): Promise<void> {
  const job = await transaction.selectFrom("jobs").select(["status", "progress"]).where("id", "=", claim.jobId).executeTakeFirstOrThrow();
  const progress = { ...job.progress, completed: Number(job.progress.completed ?? 0) + 1, current: claim.kind };
  await transaction.updateTable("job_steps").set({ status: "completed", output_ref: output, lease_owner: null, lease_expires_at: null, updated_at: new Date() }).where("id", "=", claim.stepId).execute();
  await transaction.updateTable("job_attempts").set({ status: "completed", finished_at: new Date() }).where("id", "=", claim.attemptId).execute();
  await transaction.updateTable("jobs").set({ status: "completed", progress, updated_at: new Date() }).where("id", "=", claim.jobId).execute();
  await transaction.insertInto("job_events").values({ job_id: claim.jobId, type: "progress", dedupe_key: `step:${claim.stepId}:completed`, payload: { stepId: claim.stepId, position: claim.position, progress } }).onConflict((conflict) => conflict.columns(["job_id", "dedupe_key"]).doNothing()).execute();
  await transaction.insertInto("job_events").values({ job_id: claim.jobId, type: "completed", dedupe_key: "completed", payload: { status: "completed", progress } }).onConflict((conflict) => conflict.columns(["job_id", "dedupe_key"]).doNothing()).execute();
}

export class QueryExecutor {
  constructor(private readonly options: {
    database: DatabaseConnection;
    cipher: ContentCipher;
    dify?: DifyAdapter;
  }) {}

  async execute(claim: ClaimedStep): Promise<{ disposition: CompletionDisposition | "failed" }> {
    if (!["l2-query", "query-summary-retry", "query-local-summary"].includes(claim.kind)) throw new Error("QueryExecutor only accepts Query steps");
    const context = await this.loadContext(claim);
    const actor = await this.actorFor(context.turnId);
    const detail = await createQueryRepository(this.options.database, this.options.cipher).getTurn({ turnId: context.turnId, actor });

    let frozen = detail;
    if (claim.kind === "l2-query" && !detail.evidenceSnapshotHash) {
      frozen = await this.recallAndFreeze(claim, detail, actor, context.config);
      if (frozen.status === "completed") return { disposition: "completed" };
    } else {
      const expectedHash = context.evidenceSnapshotHash ?? detail.evidenceSnapshotHash;
      if (!expectedHash || detail.evidenceSnapshotHash !== expectedHash || (claim.kind !== "l2-query" && detail.status !== "awaiting_fallback")) return { disposition: "terminal-noop" };
      const adopted = await this.adoptAttempt(claim, detail, expectedHash);
      if (adopted) return { disposition: adopted };
    }

    const used = frozen.evidence.filter((item) => item.disposition === "used");
    if (claim.kind === "query-local-summary") {
      const answer = used.length === 0 ? NO_EVIDENCE_ANSWER : used.map((item) => `- 第 ${item.chapterIndex} 章：${item.body}`).join("\n");
      return this.complete(claim, frozen, actor, answer, "degraded", "local_summary");
    }
    if (used.length === 0) return this.complete(claim, frozen, actor, NO_EVIDENCE_ANSWER, "completed", "no_evidence");
    if (!this.options.dify) return this.awaitFallback(claim, frozen, "configuration_error");

    try {
      const output = await this.options.dify.runAnalysisSummary({
        invocationKey: `${frozen.id}:${claim.attemptId}`,
        taskType: "l2_query",
        prompt: "只依据本轮采用证据回答，并保留章节引用",
        contextJson: JSON.stringify({
          question: frozen.question,
          intent: frozen.intentSnapshot,
          evidence: used.map((item) => ({ factId: item.factId, chapterIndex: item.chapterIndex, subjectKey: item.subjectKey, factType: item.factType, body: item.body })),
        }),
      });
      return this.complete(claim, frozen, actor, output.text, "completed", null);
    } catch (error) {
      const code = error instanceof DifyAdapterError ? error.code : "provider_invalid_response";
      return this.awaitFallback(claim, frozen, code);
    }
  }

  private async loadContext(claim: ClaimedStep): Promise<QueryContext> {
    const row = await this.options.database.selectFrom("jobs").innerJoin("job_steps", "job_steps.job_id", "jobs.id")
      .select(["jobs.config_snapshot", "job_steps.output_ref"]).where("jobs.id", "=", claim.jobId).where("job_steps.id", "=", claim.stepId).executeTakeFirstOrThrow();
    if (!row.output_ref) throw new Error("Invalid Query job configuration");
    const turnId = row.output_ref.turnId;
    const evidenceSnapshotHash = row.output_ref.evidenceSnapshotHash;
    if (typeof turnId !== "string" || (evidenceSnapshotHash !== undefined && typeof evidenceSnapshotHash !== "string")) throw new Error("Invalid Query job configuration");
    return { turnId, evidenceSnapshotHash, config: row.config_snapshot };
  }

  private async actorFor(turnId: string): Promise<QueryActor> {
    const row = await this.options.database.selectFrom("query_turns").select("created_by").where("id", "=", turnId).executeTakeFirstOrThrow();
    return { id: row.created_by, role: "member" };
  }

  private async recallAndFreeze(claim: ClaimedStep, detail: QueryTurnDetail, actor: QueryActor, config: Record<string, unknown>): Promise<QueryTurnDetail> {
    const session = await this.options.database.selectFrom("query_sessions").select("group_id").where("id", "=", detail.sessionId).executeTakeFirstOrThrow();
    const repository = createIndexRepository(this.options.database, this.options.cipher);
    const knownSubjects = await repository.listVerifiedSubjects(session.group_id);
    const priorIds = await this.options.database.selectFrom("query_turns").select("id").where("session_id", "=", detail.sessionId).where("id", "!=", detail.id).where("created_at", "<=", detail.createdAt).orderBy("created_at", "desc").orderBy("id", "desc").limit(3).execute();
    const queryRepository = createQueryRepository(this.options.database, this.options.cipher);
    const recentQuestions = (await Promise.all(priorIds.reverse().map((row) => queryRepository.getTurn({ turnId: row.id, actor })))).map((turn) => turn.question);
    const intent = resolveQueryIntent({ question: detail.question, recentQuestions, knownSubjects });
    const facts = [];
    let cursor: string | undefined;
    do {
      const page = await repository.listFactReviews({ groupId: session.group_id, limit: 100, cursor });
      facts.push(...page.facts.filter((fact) => fact.chapterIndex >= detail.startChapter && fact.chapterIndex <= detail.endChapter).map((fact) => ({ ...fact, category: typeof fact.metadata.category === "string" ? fact.metadata.category : undefined })));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    const windows = new Map<number, RecallWindow["facts"] extends readonly (infer T)[] ? T[] : never>();
    const lastWindow = Math.floor((detail.endChapter - detail.startChapter) / WINDOW_SIZE);
    for (let windowIndex = 0; windowIndex <= lastWindow; windowIndex += 1) windows.set(windowIndex, []);
    for (const fact of facts) {
      const windowIndex = Math.floor((fact.chapterIndex - detail.startChapter) / WINDOW_SIZE);
      const window = windows.get(windowIndex) ?? [];
      window.push(fact);
      windows.set(windowIndex, window);
    }
    const recall = recallFacts({ intent, windows: [...windows].sort(([left], [right]) => left - right).map(([windowIndex, windowFacts]) => ({ windowIndex, facts: windowFacts })), ...limits(config) });
    const snapshot = sourceSnapshot({ candidates: recall.candidates.length, used: recall.used.length, gaps: recall.gaps.length });
    const disposition = await this.options.database.transaction().execute(async (transaction) => {
      const invalid = await validateClaim(transaction, claim);
      if (invalid) return invalid;
      await transaction.updateTable("query_turns").set({ status: "running", intent_snapshot: intent, source_snapshot: snapshot, gap_snapshot: { count: recall.gaps.length }, attempt_id: claim.attemptId, updated_at: new Date() }).where("id", "=", detail.id).execute();
      await createQueryRepository(transaction, this.options.cipher).commitEvidence({ turnId: detail.id, actor, evidence: recall.candidates.map((candidate) => ({ factId: candidate.id, rank: candidate.rank, recallReason: candidate.recallReason, disposition: candidate.disposition, ...(candidate.exclusionReason ? { exclusionReason: candidate.exclusionReason } : {}) })) });
      return null;
    });
    if (disposition) return { ...detail, status: "completed" };
    return createQueryRepository(this.options.database, this.options.cipher).getTurn({ turnId: detail.id, actor });
  }

  private async adoptAttempt(claim: ClaimedStep, detail: QueryTurnDetail, evidenceSnapshotHash: string): Promise<CompletionDisposition | null> {
    return this.options.database.transaction().execute(async (transaction) => {
      const invalid = await validateClaim(transaction, claim);
      if (invalid) return invalid;
      const turn = await transaction.selectFrom("query_turns").select(["status", "evidence_snapshot_hash"]).where("id", "=", detail.id).forUpdate().executeTakeFirst();
      if (!turn || turn.evidence_snapshot_hash !== evidenceSnapshotHash || ["completed", "degraded", "failed", "cancelled"].includes(turn.status)) return "terminal-noop";
      await transaction.updateTable("query_turns").set({ status: "running", attempt_id: claim.attemptId, updated_at: new Date() }).where("id", "=", detail.id).execute();
      return null;
    });
  }

  private complete(claim: ClaimedStep, detail: QueryTurnDetail, actor: QueryActor, answer: string, status: "completed" | "degraded", degradation: string | null): Promise<{ disposition: CompletionDisposition }> {
    return this.options.database.transaction().execute(async (transaction) => {
      const invalid = await validateClaim(transaction, claim);
      if (invalid) return { disposition: invalid };
      const turn = await createQueryRepository(transaction, this.options.cipher).completeTurn({ turnId: detail.id, actor, answer, status, evidenceSnapshotHash: detail.evidenceSnapshotHash!, sourceSnapshot: detail.sourceSnapshot, gapSnapshot: detail.gapSnapshot, degradation, jobId: claim.jobId, attemptId: claim.attemptId });
      await finishClaim(transaction, claim, { turnId: turn.id, status: turn.status, evidenceSnapshotHash: turn.evidenceSnapshotHash });
      return { disposition: "completed" };
    });
  }

  private awaitFallback(claim: ClaimedStep, detail: QueryTurnDetail, errorCode: string): Promise<{ disposition: "failed" | CompletionDisposition }> {
    return this.options.database.transaction().execute(async (transaction) => {
      const invalid = await validateClaim(transaction, claim);
      if (invalid) return { disposition: invalid };
      const turn = await transaction.selectFrom("query_turns").select(["status", "attempt_id", "evidence_snapshot_hash"]).where("id", "=", detail.id).forUpdate().executeTakeFirst();
      if (!turn || turn.status !== "running" || turn.attempt_id !== claim.attemptId || turn.evidence_snapshot_hash !== detail.evidenceSnapshotHash) return { disposition: "terminal-noop" };
      await transaction.updateTable("query_turns").set({ status: "awaiting_fallback", degradation: errorCode, updated_at: new Date() }).where("id", "=", detail.id).execute();
      const job = await transaction.selectFrom("jobs").select("progress").where("id", "=", claim.jobId).executeTakeFirstOrThrow();
      const progress = { ...job.progress, failed: Number(job.progress.failed ?? 0) + 1, current: claim.kind };
      await transaction.updateTable("job_attempts").set({ status: "failed", error_code: errorCode, error_message: errorCode, finished_at: new Date() }).where("id", "=", claim.attemptId).execute();
      await transaction.updateTable("job_steps").set({ status: "failed", lease_owner: null, lease_expires_at: null, updated_at: new Date() }).where("id", "=", claim.stepId).execute();
      await transaction.updateTable("jobs").set({ status: "failed", progress, updated_at: new Date() }).where("id", "=", claim.jobId).execute();
      await transaction.insertInto("job_events").values({ job_id: claim.jobId, type: "failed", dedupe_key: `step:${claim.stepId}:failed`, payload: { stepId: claim.stepId, position: claim.position, errorCode, progress } }).onConflict((conflict) => conflict.columns(["job_id", "dedupe_key"]).doNothing()).execute();
      return { disposition: "failed" };
    });
  }
}
