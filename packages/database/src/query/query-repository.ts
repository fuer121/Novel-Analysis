import { createHash } from "node:crypto";

import { sql } from "kysely";

import type { DatabaseExecutor, QueryTurnStatus, QueryVisibility } from "../db.js";
import type { ContentCipher, EncryptedContent } from "../library/content-encryption.js";

type JsonObject = Record<string, unknown>;
const CONTENT_FIELD_NAMES = new Set(["answer", "body", "fact", "question", "title"]);
export interface QueryActor { id: string; role: "admin" | "member" }
export interface QuerySession { id: string; bookId: string; groupId: string; createdBy: string; visibility: QueryVisibility; defaultStartChapter: number; defaultEndChapter: number; title: string; archivedAt: Date | null; createdAt: Date; updatedAt: Date }
export interface QueryTurn { id: string; sessionId: string; createdBy: string; question: string; answer: string | null; questionHmac: string; startChapter: number; endChapter: number; intentSnapshot: JsonObject; sourceSnapshot: JsonObject; gapSnapshot: JsonObject; configSnapshot: JsonObject; executionSignature: string; evidenceSnapshotHash: string | null; status: QueryTurnStatus; jobId: string | null; attemptId: string | null; degradation: string | null; createdAt: Date; updatedAt: Date; completedAt: Date | null }
export interface QueryTurnEvidence { factId: string; chapterId: string; chapterIndex: number; rank: number; recallReason: string; disposition: "used" | "excluded"; exclusionReason: string | null; subjectKey: string; factType: string; body: string }
export interface QueryTurnDetail extends QueryTurn { evidence: QueryTurnEvidence[] }
export interface CreateQuerySessionInput { bookId: string; groupId: string; createdBy: string; title: string; visibility?: QueryVisibility; defaultStartChapter: number; defaultEndChapter: number }
export interface ManageQuerySessionInput { sessionId: string; actor: QueryActor; title?: string; visibility?: QueryVisibility }
export interface CreateQueryTurnInput { sessionId: string; actor: QueryActor; question: string; questionHmac: string; startChapter: number; endChapter: number; intentSnapshot: JsonObject; sourceSnapshot: JsonObject; gapSnapshot: JsonObject; configSnapshot: JsonObject; executionSignature: string; jobId?: string; attemptId?: string }
export interface CommitTurnEvidenceInput { turnId: string; actor: QueryActor; evidence: Array<{ factId: string; rank: number; recallReason: string; disposition: "used" | "excluded"; exclusionReason?: string }> }
export interface CompleteTurnInput { turnId: string; actor: QueryActor; answer: string | null; status: "completed" | "degraded" | "failed" | "cancelled"; evidenceSnapshotHash: string; sourceSnapshot: JsonObject; gapSnapshot: JsonObject; degradation: string | null; jobId?: string; attemptId?: string }

const encrypted = (row: { ciphertext: Buffer; nonce: Buffer; tag: Buffer; key_version: string }): EncryptedContent => ({ ciphertext: row.ciphertext, nonce: row.nonce, tag: row.tag, keyVersion: row.key_version });

function stableError(error: unknown, message: string): never {
  if (error instanceof Error && ["Query access denied", "Evidence snapshot already committed"].includes(error.message)) throw error;
  throw new Error(message);
}

function assertContentFreeSnapshot(value: JsonObject): void {
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) { current.forEach(visit); return; }
    if (!current || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current)) {
      if (CONTENT_FIELD_NAMES.has(key)) throw new Error("Invalid query snapshot");
      visit(child);
    }
  };
  visit(value);
}

export function createQueryRepository(db: DatabaseExecutor, cipher: ContentCipher) {
  const mapSession = (row: { id: string; book_id: string; group_id: string; created_by: string; visibility: QueryVisibility; default_start_chapter: number; default_end_chapter: number; title_ciphertext: Buffer; title_nonce: Buffer; title_tag: Buffer; title_key_version: string; archived_at: Date | null; created_at: Date; updated_at: Date }): QuerySession => ({ id: row.id, bookId: row.book_id, groupId: row.group_id, createdBy: row.created_by, visibility: row.visibility, defaultStartChapter: row.default_start_chapter, defaultEndChapter: row.default_end_chapter, title: cipher.decrypt(encrypted({ ciphertext: row.title_ciphertext, nonce: row.title_nonce, tag: row.title_tag, key_version: row.title_key_version })), archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at });
  const mapTurn = (row: { id: string; session_id: string; created_by: string; question_ciphertext: Buffer; question_nonce: Buffer; question_tag: Buffer; question_key_version: string; answer_ciphertext: Buffer | null; answer_nonce: Buffer | null; answer_tag: Buffer | null; answer_key_version: string | null; question_hmac: string; start_chapter: number; end_chapter: number; intent_snapshot: JsonObject; source_snapshot: JsonObject; gap_snapshot: JsonObject; config_snapshot: JsonObject; execution_signature: string; evidence_snapshot_hash: string | null; status: QueryTurnStatus; job_id: string | null; attempt_id: string | null; degradation: string | null; created_at: Date; updated_at: Date; completed_at: Date | null }): QueryTurn => ({ id: row.id, sessionId: row.session_id, createdBy: row.created_by, question: cipher.decrypt(encrypted({ ciphertext: row.question_ciphertext, nonce: row.question_nonce, tag: row.question_tag, key_version: row.question_key_version })), answer: row.answer_ciphertext && row.answer_nonce && row.answer_tag && row.answer_key_version ? cipher.decrypt(encrypted({ ciphertext: row.answer_ciphertext, nonce: row.answer_nonce, tag: row.answer_tag, key_version: row.answer_key_version })) : null, questionHmac: row.question_hmac, startChapter: row.start_chapter, endChapter: row.end_chapter, intentSnapshot: row.intent_snapshot, sourceSnapshot: row.source_snapshot, gapSnapshot: row.gap_snapshot, configSnapshot: row.config_snapshot, executionSignature: row.execution_signature, evidenceSnapshotHash: row.evidence_snapshot_hash, status: row.status, jobId: row.job_id, attemptId: row.attempt_id, degradation: row.degradation, createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at });

  async function authorizedTurn(turnId: string, actor: QueryActor, manage = false, executor: DatabaseExecutor = db) {
    const row = await executor.selectFrom("query_turns as t").innerJoin("query_sessions as s", "s.id", "t.session_id").select(["t.id", "t.created_by", "s.visibility", "s.created_by as session_created_by"]).where("t.id", "=", turnId).executeTakeFirst();
    const visible = row && (actor.role === "admin" || row.session_created_by === actor.id || row.visibility === "team");
    const manageable = row && (actor.role === "admin" || row.created_by === actor.id);
    if (!visible || (manage && !manageable)) throw new Error("Query access denied");
    return row;
  }

  return {
    async createSession(input: CreateQuerySessionInput): Promise<QuerySession> {
      try {
        if (!input.title.trim()) throw new Error();
        const title = cipher.encrypt(input.title);
        const row = await db.insertInto("query_sessions").values({ book_id: input.bookId, group_id: input.groupId, created_by: input.createdBy, visibility: input.visibility ?? "private", default_start_chapter: input.defaultStartChapter, default_end_chapter: input.defaultEndChapter, title_ciphertext: title.ciphertext, title_nonce: title.nonce, title_tag: title.tag, title_key_version: title.keyVersion }).returningAll().executeTakeFirstOrThrow();
        return mapSession(row);
      } catch (error) { stableError(error, "Invalid query session"); }
    },
    async listVisibleSessions(input: { bookId: string; actor: QueryActor }): Promise<QuerySession[]> {
      let query = db.selectFrom("query_sessions").selectAll().where("book_id", "=", input.bookId).orderBy("updated_at", "desc").orderBy("id");
      if (input.actor.role !== "admin") query = query.where((expression) => expression.or([expression("created_by", "=", input.actor.id), expression("visibility", "=", "team")]));
      return (await query.execute()).map(mapSession);
    },
    async updateSession(input: ManageQuerySessionInput): Promise<QuerySession> {
      const authorization = await db.selectFrom("query_sessions").select(["created_by"]).where("id", "=", input.sessionId).executeTakeFirst();
      if (!authorization || (input.actor.role !== "admin" && authorization.created_by !== input.actor.id)) throw new Error("Query access denied");
      try {
        const values: Record<string, unknown> = { updated_at: new Date() };
        if (input.title !== undefined) {
          if (!input.title.trim()) throw new Error();
          const title = cipher.encrypt(input.title); Object.assign(values, { title_ciphertext: title.ciphertext, title_nonce: title.nonce, title_tag: title.tag, title_key_version: title.keyVersion });
        }
        if (input.visibility !== undefined) values.visibility = input.visibility;
        const row = await db.updateTable("query_sessions").set(values).where("id", "=", input.sessionId).returningAll().executeTakeFirstOrThrow();
        return mapSession(row);
      } catch (error) { stableError(error, "Invalid query session"); }
    },
    async archiveSession(input: { sessionId: string; actor: QueryActor }): Promise<void> {
      const row = await db.selectFrom("query_sessions").select("created_by").where("id", "=", input.sessionId).executeTakeFirst();
      if (!row || (input.actor.role !== "admin" && row.created_by !== input.actor.id)) throw new Error("Query access denied");
      await db.updateTable("query_sessions").set({ archived_at: new Date(), updated_at: new Date() }).where("id", "=", input.sessionId).execute();
    },
    async createTurn(input: CreateQueryTurnInput): Promise<QueryTurn> {
      const session = await db.selectFrom("query_sessions").select(["created_by", "visibility", "archived_at"]).where("id", "=", input.sessionId).executeTakeFirst();
      if (!session || session.archived_at || (input.actor.role !== "admin" && session.created_by !== input.actor.id && session.visibility !== "team")) throw new Error("Query access denied");
      try {
        if (!input.question.trim()) throw new Error();
        [input.intentSnapshot, input.sourceSnapshot, input.gapSnapshot, input.configSnapshot].forEach(assertContentFreeSnapshot);
        const question = cipher.encrypt(input.question);
        const row = await db.insertInto("query_turns").values({ session_id: input.sessionId, created_by: input.actor.id, question_ciphertext: question.ciphertext, question_nonce: question.nonce, question_tag: question.tag, question_key_version: question.keyVersion, question_hmac: input.questionHmac, start_chapter: input.startChapter, end_chapter: input.endChapter, intent_snapshot: input.intentSnapshot, source_snapshot: input.sourceSnapshot, gap_snapshot: input.gapSnapshot, config_snapshot: input.configSnapshot, execution_signature: input.executionSignature, job_id: input.jobId ?? null, attempt_id: input.attemptId ?? null }).returningAll().executeTakeFirstOrThrow();
        return mapTurn(row);
      } catch (error) { stableError(error, "Invalid query turn"); }
    },
    async commitEvidence(input: CommitTurnEvidenceInput): Promise<void> {
      const commit = async (executor: DatabaseExecutor) => {
        await authorizedTurn(input.turnId, input.actor, true, executor);
        const locked = await sql<{ evidence_snapshot_hash: string | null }>`select evidence_snapshot_hash from query_turns where id = ${input.turnId} for update`.execute(executor);
        if (locked.rows[0]?.evidence_snapshot_hash) throw new Error("Evidence snapshot already committed");
        const snapshotHash = createHash("sha256").update(JSON.stringify(input.evidence)).digest("hex");
        try {
          for (const evidence of input.evidence) await executor.insertInto("turn_evidence").values({ turn_id: input.turnId, fact_id: evidence.factId, rank: evidence.rank, recall_reason: evidence.recallReason, disposition: evidence.disposition, exclusion_reason: evidence.exclusionReason ?? null }).execute();
          await executor.updateTable("query_turns").set({ evidence_snapshot_hash: snapshotHash, updated_at: new Date() }).where("id", "=", input.turnId).execute();
        } catch (error) { stableError(error, "Invalid turn evidence"); }
      };
      if (db.isTransaction) return commit(db);
      return db.transaction().execute(commit);
    },
    async completeTurn(input: CompleteTurnInput): Promise<QueryTurn> {
      await authorizedTurn(input.turnId, input.actor, true);
      try {
        [input.sourceSnapshot, input.gapSnapshot].forEach(assertContentFreeSnapshot);
        const snapshot = await db.selectFrom("query_turns").select("evidence_snapshot_hash").where("id", "=", input.turnId).executeTakeFirstOrThrow();
        if (!snapshot.evidence_snapshot_hash || snapshot.evidence_snapshot_hash !== input.evidenceSnapshotHash) throw new Error();
        const answer = input.answer === null ? null : cipher.encrypt(input.answer);
        const row = await db.updateTable("query_turns").set({ answer_ciphertext: answer?.ciphertext ?? null, answer_nonce: answer?.nonce ?? null, answer_tag: answer?.tag ?? null, answer_key_version: answer?.keyVersion ?? null, status: input.status, source_snapshot: input.sourceSnapshot, gap_snapshot: input.gapSnapshot, degradation: input.degradation, job_id: input.jobId, attempt_id: input.attemptId, updated_at: new Date(), completed_at: new Date() }).where("id", "=", input.turnId).returningAll().executeTakeFirstOrThrow();
        return mapTurn(row);
      } catch (error) { stableError(error, "Invalid query turn"); }
    },
    async getTurn(input: { turnId: string; actor: QueryActor }): Promise<QueryTurnDetail> {
      await authorizedTurn(input.turnId, input.actor);
      const row = await db.selectFrom("query_turns").selectAll().where("id", "=", input.turnId).executeTakeFirstOrThrow();
      const evidenceRows = await db.selectFrom("turn_evidence as e").innerJoin("l2_facts as f", "f.id", "e.fact_id").innerJoin("chapters as c", "c.id", "f.chapter_id").select(["e.fact_id", "e.rank", "e.recall_reason", "e.disposition", "e.exclusion_reason", "f.chapter_id", "c.chapter_index", "f.subject_key", "f.fact_type", "f.fact_ciphertext", "f.fact_nonce", "f.fact_tag", "f.fact_key_version"]).where("e.turn_id", "=", input.turnId).orderBy("e.rank").execute();
      return { ...mapTurn(row), evidence: evidenceRows.map((evidence) => ({ factId: evidence.fact_id, chapterId: evidence.chapter_id, chapterIndex: evidence.chapter_index, rank: evidence.rank, recallReason: evidence.recall_reason, disposition: evidence.disposition, exclusionReason: evidence.exclusion_reason, subjectKey: evidence.subject_key, factType: evidence.fact_type, body: cipher.decrypt({ ciphertext: evidence.fact_ciphertext, nonce: evidence.fact_nonce, tag: evidence.fact_tag, keyVersion: evidence.fact_key_version }) })) };
    },
  };
}
