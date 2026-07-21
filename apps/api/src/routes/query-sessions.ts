import { createHash, createHmac } from "node:crypto";
import { Router, type Response } from "express";
import { sql } from "kysely";
import { z } from "zod";

import { QueryTurnDetailSchema, QueryTurnHistoryPageSchema } from "@novel-analysis/contracts";
import { createQueryRepository, type ContentCipher, type DatabaseConnection, type QueryActor, type QuerySession, type QueryTurn, type QueryTurnDetail } from "@novel-analysis/database";
import { QueryAccessDeniedError, QueryConfigurationError, QueryIdempotencyConflictError, QueryInvalidRequestError, QueryInvalidStateError, QueryJobService, QueryNotFoundError, QueryScopeChangedError } from "@novel-analysis/jobs";

import { requireCsrf } from "../auth/csrf.js";
import { type AuthenticatedRequest, requireSession } from "../auth/session-middleware.js";
import type { ApiConfig } from "../config.js";

const paramsSchema = z.strictObject({ bookId: z.uuid(), sessionId: z.uuid().optional(), turnId: z.uuid().optional() });
const keySchema = z.string().trim().min(1).max(200);
const createSessionSchema = z.strictObject({ groupId: z.uuid(), title: z.string().trim().min(1).max(500), visibility: z.enum(["private", "team"]).default("private"), defaultStartChapter: z.number().safe().int().positive(), defaultEndChapter: z.number().safe().int().positive() }).refine((value) => value.defaultEndChapter >= value.defaultStartChapter, { path: ["defaultEndChapter"] });
const updateSessionSchema = z.strictObject({ title: z.string().trim().min(1).max(500).optional(), visibility: z.enum(["private", "team"]).optional() }).refine((value) => value.title !== undefined || value.visibility !== undefined);
const previewSchema = z.strictObject({ question: z.string().trim().min(1).max(10_000), startChapter: z.number().safe().int().positive().optional(), endChapter: z.number().safe().int().positive().optional() });
const createTurnSchema = previewSchema.extend({ scopeHash: z.string().regex(/^[a-f0-9]{64}$/) });
const historyQuerySchema = z.strictObject({ limit: z.coerce.number().int().positive().max(100).default(20), cursor: z.string().regex(/^[A-Za-z0-9_-]+$/).optional() });
const emptySchema = z.strictObject({});

function actor(request: AuthenticatedRequest): QueryActor { return { id: request.auth!.userId, role: request.auth!.role }; }
function idempotencyKey(request: AuthenticatedRequest, response: Response): string | null {
  const parsed = keySchema.safeParse(request.get("Idempotency-Key"));
  if (!parsed.success) { response.status(400).json({ error: "invalid_request" }); return null; }
  return parsed.data;
}
function publicSession(session: QuerySession, current: QueryActor) { return { id: session.id, bookId: session.bookId, groupId: session.groupId, createdBy: session.createdBy, title: session.title, visibility: session.visibility, defaultStartChapter: session.defaultStartChapter, defaultEndChapter: session.defaultEndChapter, canManage: current.role === "admin" || session.createdBy === current.id, archivedAt: session.archivedAt?.toISOString() ?? null }; }
function publicTurn(turn: QueryTurn) {
  const intent = turn.intentSnapshot as Partial<Record<"kind" | "target" | "aliases" | "referents" | "categories" | "keywords", unknown>>;
  const source = turn.sourceSnapshot as Partial<Record<"candidates" | "used" | "excluded" | "gaps", unknown>>;
  const gaps = turn.gapSnapshot as Partial<Record<"count", unknown>>;
  const config = turn.configSnapshot as Partial<Record<"recallPolicyVersion" | "summaryWorkflowVersion", unknown>>;
  const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
  const text = (value: unknown) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  const strings = (value: unknown, limit: number) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter((item) => item.length > 0).slice(0, limit) : [];
  const candidates = count(source.candidates); const used = count(source.used); const excluded = count(source.excluded); const gapCount = count(gaps.count ?? source.gaps);
  return {
    id: turn.id, sessionId: turn.sessionId, createdBy: turn.createdBy, question: turn.question,
    startChapter: turn.startChapter, endChapter: turn.endChapter, status: turn.status,
    answer: turn.answer, degradation: turn.degradation,
    sourceStats: { candidates, used, excluded, gaps: gapCount },
    trace: {
      kind: ["single-target", "collection", "general"].includes(String(intent.kind)) ? intent.kind as "single-target" | "collection" | "general" : null,
      target: text(intent.target),
      aliases: strings(intent.aliases, 20), referents: strings(intent.referents, 20), categories: strings(intent.categories, 20), keywords: strings(intent.keywords, 50),
      sourceCounts: { candidates, used, excluded }, gapCount,
      recallPolicyVersion: text(config.recallPolicyVersion),
      summaryWorkflowVersion: text(config.summaryWorkflowVersion),
    },
  };
}
function publicTurnDetail(turn: QueryTurnDetail) { return { ...publicTurn(turn), evidence: turn.evidence.map((item) => ({ turnId: turn.id, factId: item.factId, chapterIndex: item.chapterIndex, body: item.body, rank: item.rank, recallReason: item.recallReason, disposition: item.disposition, exclusionReason: item.exclusionReason })) }; }
function publicCreatedTurn(turn: QueryTurnDetail) { const detail = publicTurnDetail(turn); return { id: detail.id, sessionId: detail.sessionId, createdBy: detail.createdBy, question: detail.question, startChapter: detail.startChapter, endChapter: detail.endChapter, status: detail.status, answer: detail.answer, degradation: detail.degradation, sourceStats: detail.sourceStats, evidence: detail.evidence }; }
function encodeCursor(turnId: string): string { return Buffer.from(turnId, "utf8").toString("base64url"); }
function decodeCursor(cursor: string): string | null { try { const decoded = Buffer.from(cursor, "base64url").toString("utf8"); return z.uuid().safeParse(decoded).success && encodeCursor(decoded) === cursor ? decoded : null; } catch { return null; } }
function fingerprint(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

function handleError(error: unknown, response: Response, next: (error: Error) => void): void {
  if (error instanceof QueryNotFoundError) { response.status(404).json({ error: "not_found" }); return; }
  if (error instanceof QueryAccessDeniedError || error instanceof Error && error.message === "Query access denied") { response.status(403).json({ error: "forbidden" }); return; }
  if (error instanceof QueryInvalidRequestError) { response.status(400).json({ error: "invalid_request" }); return; }
  if (error instanceof Error && ["Invalid query session", "Invalid query turn"].includes(error.message)) { response.status(400).json({ error: "invalid_request" }); return; }
  if (error instanceof QueryScopeChangedError) { response.status(409).json({ error: "scope_changed" }); return; }
  if (error instanceof QueryIdempotencyConflictError) { response.status(409).json({ error: "idempotency_conflict" }); return; }
  if (error instanceof QueryConfigurationError) { response.status(409).json({ error: "query_configuration_invalid" }); return; }
  if (error instanceof QueryInvalidStateError) { response.status(409).json({ error: "invalid_state" }); return; }
  next(new Error("Query session request failed"));
}

export function createQuerySessionsRouter(database: DatabaseConnection, config: ApiConfig, cipher: ContentCipher, hmacKey: Buffer): Router {
  const router = Router(); const sessionAuth = requireSession(database, config); const csrf = requireCsrf(database, config);
  const repository = createQueryRepository(database, cipher); const jobs = new QueryJobService(database, cipher, { hmacKey, recallPolicyVersion: "query-recall-v1" });

  router.get("/:bookId/query-sessions", sessionAuth, async (request: AuthenticatedRequest, response, next) => {
    const params = paramsSchema.safeParse(request.params); if (!params.success) { response.status(400).json({ error: "invalid_request" }); return; }
    try { const current = actor(request); response.json({ sessions: (await repository.listVisibleSessions({ bookId: params.data.bookId, actor: current })).map((item) => publicSession(item, current)) }); } catch { next(new Error("Query session list failed")); }
  });

  router.post("/:bookId/query-sessions", ...csrf, async (request: AuthenticatedRequest, response, next) => {
    const params = paramsSchema.safeParse(request.params); const body = createSessionSchema.safeParse(request.body); const key = idempotencyKey(request, response);
    if (!params.success || !body.success || !key) { if (!response.headersSent) response.status(400).json({ error: "invalid_request" }); return; }
    try {
      const current = actor(request);
      const titleHmac = createHmac("sha256", hmacKey).update(body.data.title).digest("hex");
      const requestFingerprint = fingerprint({ bookId: params.data.bookId, groupId: body.data.groupId, titleHmac, visibility: body.data.visibility, defaultStartChapter: body.data.defaultStartChapter, defaultEndChapter: body.data.defaultEndChapter });
      const created = await database.transaction().execute(async (transaction) => {
        await sql`select pg_advisory_xact_lock(hashtext(${`${current.id}:query-session:${key}`}))`.execute(transaction);
        const audit = await transaction.selectFrom("audit_logs").select(["target_id", "metadata"]).where("actor_user_id", "=", current.id).where("action", "=", "query_session.create").where(sql<boolean>`metadata ->> 'requestId' = ${key}`).executeTakeFirst();
        if (audit) {
          if (audit.metadata.requestFingerprint !== requestFingerprint) throw new QueryIdempotencyConflictError();
          const existing = (await createQueryRepository(transaction, cipher).listVisibleSessions({ bookId: params.data.bookId, actor: current })).find((item) => item.id === audit.target_id);
          if (!existing) throw new QueryNotFoundError(); return existing;
        }
        const createdSession = await createQueryRepository(transaction, cipher).createSession({ bookId: params.data.bookId, createdBy: current.id, ...body.data });
        await transaction.insertInto("audit_logs").values({ actor_user_id: current.id, action: "query_session.create", target_type: "query_session", target_id: createdSession.id, metadata: { requestId: key, requestFingerprint } }).execute();
        return createdSession;
      });
      response.status(201).json({ session: publicSession(created, current) });
    } catch (error) { handleError(error, response, next); }
  });

  router.get("/:bookId/query-sessions/:sessionId", sessionAuth, async (request: AuthenticatedRequest, response, next) => {
    const params = paramsSchema.safeParse(request.params); if (!params.success || !params.data.sessionId) { response.status(400).json({ error: "invalid_request" }); return; }
    try { const current = actor(request); const found = (await repository.listVisibleSessions({ bookId: params.data.bookId, actor: current })).find((item) => item.id === params.data.sessionId); if (!found) throw new QueryNotFoundError(); response.json({ session: publicSession(found, current) }); } catch (error) { handleError(error, response, next); }
  });

  router.patch("/:bookId/query-sessions/:sessionId", ...csrf, async (request: AuthenticatedRequest, response, next) => {
    const params = paramsSchema.safeParse(request.params); const body = updateSessionSchema.safeParse(request.body); const key = idempotencyKey(request, response); if (!params.success || !params.data.sessionId || !body.success || !key) { if (!response.headersSent) response.status(400).json({ error: "invalid_request" }); return; }
    try { const current = actor(request); const visible = (await repository.listVisibleSessions({ bookId: params.data.bookId, actor: current })).find((item) => item.id === params.data.sessionId); if (!visible) throw new QueryNotFoundError(); response.json({ session: publicSession(await repository.updateSession({ sessionId: visible.id, actor: current, ...body.data }), current) }); } catch (error) { handleError(error, response, next); }
  });

  router.post("/:bookId/query-sessions/:sessionId/archive", ...csrf, async (request: AuthenticatedRequest, response, next) => {
    const params = paramsSchema.safeParse(request.params); const body = emptySchema.safeParse(request.body); const key = idempotencyKey(request, response); if (!params.success || !params.data.sessionId || !body.success || !key) { if (!response.headersSent) response.status(400).json({ error: "invalid_request" }); return; }
    try { const current = actor(request); const visible = (await repository.listVisibleSessions({ bookId: params.data.bookId, actor: current })).find((item) => item.id === params.data.sessionId); if (!visible) throw new QueryNotFoundError(); await repository.archiveSession({ sessionId: visible.id, actor: current }); response.status(204).end(); } catch (error) { handleError(error, response, next); }
  });

  router.post("/:bookId/query-sessions/:sessionId/turn-preview", ...csrf, async (request: AuthenticatedRequest, response, next) => {
    const params = paramsSchema.safeParse(request.params); const body = previewSchema.safeParse(request.body); const key = idempotencyKey(request, response); if (!params.success || !params.data.sessionId || !body.success || !key) { if (!response.headersSent) response.status(400).json({ error: "invalid_request" }); return; }
    try { response.json(await jobs.preview({ bookId: params.data.bookId, sessionId: params.data.sessionId, actor: actor(request), ...body.data })); } catch (error) { handleError(error, response, next); }
  });

  router.post("/:bookId/query-sessions/:sessionId/turns", ...csrf, async (request: AuthenticatedRequest, response, next) => {
    const params = paramsSchema.safeParse(request.params); const body = createTurnSchema.safeParse(request.body); const key = idempotencyKey(request, response); if (!params.success || !params.data.sessionId || !body.success || !key) { if (!response.headersSent) response.status(400).json({ error: "invalid_request" }); return; }
    try { const created = await jobs.createTurn({ bookId: params.data.bookId, sessionId: params.data.sessionId, actor: actor(request), requestId: key, ...body.data }); response.status(201).json({ turn: publicCreatedTurn({ ...created.turn, evidence: [] }), job: created.job }); } catch (error) { handleError(error, response, next); }
  });

  router.get("/:bookId/query-sessions/:sessionId/turns", sessionAuth, async (request: AuthenticatedRequest, response, next) => {
    const params = paramsSchema.safeParse(request.params); const query = historyQuerySchema.safeParse(request.query);
    if (!params.success || !params.data.sessionId || !query.success) { response.status(400).json({ error: "invalid_request" }); return; }
    const cursor = query.data.cursor ? decodeCursor(query.data.cursor) : undefined;
    if (query.data.cursor && !cursor) { response.status(400).json({ error: "invalid_request" }); return; }
    try {
      const current = actor(request);
      const visible = (await repository.listVisibleSessions({ bookId: params.data.bookId, actor: current })).some((item) => item.id === params.data.sessionId);
      if (!visible) throw new QueryNotFoundError();
      try {
        const page = await repository.listTurns({ sessionId: params.data.sessionId, actor: current, limit: query.data.limit, cursor: cursor ?? undefined });
        response.json(QueryTurnHistoryPageSchema.parse({ turns: page.turns.map(publicTurn), nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null }));
      } catch (error) {
        if (error instanceof Error && error.message === "Query access denied") throw new QueryNotFoundError();
        throw error;
      }
    } catch (error) { handleError(error, response, next); }
  });

  router.get("/:bookId/query-sessions/:sessionId/turns/:turnId", sessionAuth, async (request: AuthenticatedRequest, response, next) => {
    const params = paramsSchema.safeParse(request.params); if (!params.success || !params.data.sessionId || !params.data.turnId) { response.status(400).json({ error: "invalid_request" }); return; }
    try { const current = actor(request); const visible = (await repository.listVisibleSessions({ bookId: params.data.bookId, actor: current })).some((item) => item.id === params.data.sessionId); if (!visible) throw new QueryNotFoundError(); const turn = await repository.getTurn({ turnId: params.data.turnId, actor: current }); if (turn.sessionId !== params.data.sessionId) throw new QueryNotFoundError(); response.json({ turn: QueryTurnDetailSchema.parse(publicTurnDetail(turn)) }); } catch (error) { handleError(error, response, next); }
  });

  const fallback = (kind: "retry" | "local") => async (request: AuthenticatedRequest, response: Response, next: (error: Error) => void) => {
    const params = paramsSchema.safeParse(request.params); const body = emptySchema.safeParse(request.body); const key = idempotencyKey(request, response); if (!params.success || !params.data.sessionId || !params.data.turnId || !body.success || !key) { if (!response.headersSent) response.status(400).json({ error: "invalid_request" }); return; }
    try { const input = { bookId: params.data.bookId, sessionId: params.data.sessionId, turnId: params.data.turnId, actor: actor(request), requestId: key }; const job = kind === "retry" ? await jobs.retrySummary(input) : await jobs.requestLocalSummary(input); response.status(201).json({ job }); } catch (error) { handleError(error, response, next); }
  };
  router.post("/:bookId/query-sessions/:sessionId/turns/:turnId/retry-summary", ...csrf, fallback("retry"));
  router.post("/:bookId/query-sessions/:sessionId/turns/:turnId/local-summary", ...csrf, fallback("local"));
  return router;
}
