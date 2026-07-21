import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";

import { AnalysisRunCreateInputSchema, AnalysisRunDetailSchema, AnalysisRunSummarySchema, AnalysisScopePreviewInputSchema, AnalysisScopePreviewSchema, AnalysisTemplateCreateInputSchema, AnalysisTemplateDetailSchema, AnalysisTemplateSummarySchema, AnalysisTemplateUpdateInputSchema } from "@novel-analysis/contracts";
import { createAnalysisRepository, type ContentCipher, type DatabaseConnection } from "@novel-analysis/database";
import { AnalysisIdempotencyConflictError, AnalysisInvalidRequestError, AnalysisInvalidStateError, AnalysisJobService, AnalysisNotFoundError, AnalysisScopeChangedError } from "@novel-analysis/jobs";

import { requireCsrf } from "../auth/csrf.js";
import { type AuthenticatedRequest, requireSession } from "../auth/session-middleware.js";
import type { ApiConfig } from "../config.js";

const paramsSchema = z.strictObject({ bookId: z.uuid(), templateId: z.uuid().optional(), runId: z.uuid().optional() });
const emptySchema = z.strictObject({});
const actor = (request: AuthenticatedRequest) => ({ id: request.auth!.userId, role: request.auth!.role });
const contentHash = (prompt: string, outputSchema: unknown) => createHash("sha256").update(JSON.stringify({ prompt, outputSchema })).digest("hex");
const summary = (row: { id: string; bookId: string; name: string; currentVersionId: string; indexGroupId: string | null; createdAt: Date; updatedAt: Date }) => AnalysisTemplateSummarySchema.parse({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
const detail = (row: { id: string; bookId: string; name: string; currentVersionId: string; indexGroupId: string | null; prompt: string; outputSchema: unknown; createdAt: Date; updatedAt: Date }) => AnalysisTemplateDetailSchema.parse({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });

function handle(error: unknown, response: import("express").Response, next: (error: Error) => void) {
  if (error instanceof AnalysisNotFoundError || error instanceof Error && error.message === "Analysis access denied") { response.status(404).json({ error: "not_found" }); return; }
  if (error instanceof AnalysisInvalidRequestError) { response.status(400).json({ error: "invalid_request" }); return; }
  if (error instanceof AnalysisScopeChangedError) { response.status(409).json({ error: "scope_changed" }); return; }
  if (error instanceof AnalysisIdempotencyConflictError) { response.status(409).json({ error: "idempotency_conflict" }); return; }
  if (error instanceof AnalysisInvalidStateError) { response.status(409).json({ error: "invalid_state" }); return; }
  next(new Error("Advanced analysis request failed"));
}

export function createAdvancedAnalysisRouter(database: DatabaseConnection, config: ApiConfig, cipher: ContentCipher): Router {
  const router = Router(); const session = requireSession(database, config); const csrf = requireCsrf(database, config); const jobs = new AnalysisJobService(database, cipher);

  router.get("/:bookId/analysis-templates", session, async (request: AuthenticatedRequest, response, next) => {
    const params = paramsSchema.safeParse(request.params); if (!params.success) { response.status(400).json({ error: "invalid_request" }); return; }
    try { response.json({ templates: (await createAnalysisRepository(database, cipher).listTemplates({ bookId: params.data.bookId, actor: actor(request) })).map(summary) }); } catch (error) { handle(error, response, next); }
  });
  router.post("/:bookId/analysis-templates", ...csrf, async (request: AuthenticatedRequest, response, next) => {
    const params = paramsSchema.safeParse(request.params); const body = AnalysisTemplateCreateInputSchema.safeParse(request.body); if (!params.success || !body.success || body.data.bookId !== params.data.bookId) { response.status(400).json({ error: "invalid_request" }); return; }
    try {
      if (request.auth!.role === "admin") throw new AnalysisNotFoundError();
      const book = await database.selectFrom("books").select("id").where("id", "=", params.data.bookId).where("status", "=", "active").executeTakeFirst();
      const group = body.data.indexGroupId ? await database.selectFrom("index_groups").select("id").where("id", "=", body.data.indexGroupId).where("book_id", "=", params.data.bookId).where("status", "=", "active").executeTakeFirst() : null;
      if (!book || body.data.indexGroupId && !group) throw new AnalysisNotFoundError();
      const created = await createAnalysisRepository(database, cipher).createTemplate({ ...body.data, createdBy: request.auth!.userId, contentHash: contentHash(body.data.prompt, body.data.outputSchema) });
      response.status(201).json({ template: summary(created) });
    } catch (error) { handle(error, response, next); }
  });
  router.get("/:bookId/analysis-templates/:templateId", session, async (request: AuthenticatedRequest, response, next) => {
    const params = paramsSchema.safeParse(request.params); if (!params.success || !params.data.templateId) { response.status(400).json({ error: "invalid_request" }); return; }
    try { const found = await createAnalysisRepository(database, cipher).getTemplate({ templateId: params.data.templateId, actor: actor(request) }); if (found.bookId !== params.data.bookId) throw new AnalysisNotFoundError(); response.json({ template: detail(found) }); } catch (error) { handle(error, response, next); }
  });
  router.patch("/:bookId/analysis-templates/:templateId", ...csrf, async (request: AuthenticatedRequest, response, next) => {
    const params = paramsSchema.safeParse(request.params); const body = AnalysisTemplateUpdateInputSchema.safeParse(request.body); if (!params.success || !params.data.templateId || !body.success) { response.status(400).json({ error: "invalid_request" }); return; }
    try { const repository = createAnalysisRepository(database, cipher); const current = await repository.getTemplate({ templateId: params.data.templateId, actor: actor(request) }); if (current.bookId !== params.data.bookId) throw new AnalysisNotFoundError(); const group = body.data.indexGroupId ? await database.selectFrom("index_groups").select("id").where("id", "=", body.data.indexGroupId).where("book_id", "=", params.data.bookId).where("status", "=", "active").executeTakeFirst() : null; if (body.data.indexGroupId && !group) throw new AnalysisNotFoundError(); await repository.updateTemplate({ templateId: current.id, actor: actor(request), ...body.data, contentHash: contentHash(body.data.prompt, body.data.outputSchema) }); response.json({ template: detail(await repository.getTemplate({ templateId: current.id, actor: actor(request) })) }); } catch (error) { handle(error, response, next); }
  });
  router.post("/:bookId/advanced-analysis/preview", ...csrf, async (request: AuthenticatedRequest, response, next) => {
    const params = paramsSchema.safeParse(request.params); const body = AnalysisScopePreviewInputSchema.safeParse(request.body); if (!params.success || !body.success || body.data.bookId !== params.data.bookId) { response.status(400).json({ error: "invalid_request" }); return; }
    try { response.json(AnalysisScopePreviewSchema.parse(await jobs.preview({ ...body.data, actor: actor(request) }))); } catch (error) { handle(error, response, next); }
  });
  router.post("/:bookId/advanced-analysis", ...csrf, async (request: AuthenticatedRequest, response, next) => {
    const params = paramsSchema.safeParse(request.params); const body = AnalysisRunCreateInputSchema.safeParse(request.body); if (!params.success || !body.success || body.data.bookId !== params.data.bookId) { response.status(400).json({ error: "invalid_request" }); return; }
    try { const created = await jobs.create({ ...body.data, actor: actor(request), requestId: body.data.idempotencyKey }); response.status(201).json({ run: AnalysisRunSummarySchema.parse(created.run), job: created.job }); } catch (error) { handle(error, response, next); }
  });
  router.get("/:bookId/advanced-analysis", session, async (request: AuthenticatedRequest, response, next) => {
    const params = paramsSchema.safeParse(request.params); if (!params.success) { response.status(400).json({ error: "invalid_request" }); return; }
    try {
      if (request.auth!.role === "admin") throw new AnalysisNotFoundError();
      const rows = await database.selectFrom("analysis_runs").selectAll().where("book_id", "=", params.data.bookId).where("created_by", "=", request.auth!.userId).orderBy("created_at", "desc").execute();
      response.json({ runs: rows.map((row) => AnalysisRunSummarySchema.parse({ id: row.id, bookId: row.book_id, templateVersionId: row.template_version_id, jobId: row.job_id, mode: row.mode, startChapter: row.start_chapter, endChapter: row.end_chapter, status: row.status, completedParts: row.completed_parts, totalParts: row.total_parts, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() })) });
    } catch (error) { handle(error, response, next); }
  });
  router.get("/:bookId/advanced-analysis/:runId", session, async (request: AuthenticatedRequest, response, next) => {
    const params = paramsSchema.safeParse(request.params); if (!params.success || !params.data.runId) { response.status(400).json({ error: "invalid_request" }); return; }
    try {
      if (request.auth!.role === "admin") throw new AnalysisNotFoundError();
      const row = await database.selectFrom("analysis_runs").selectAll().where("id", "=", params.data.runId).where("book_id", "=", params.data.bookId).where("created_by", "=", request.auth!.userId).executeTakeFirst(); if (!row) throw new AnalysisNotFoundError();
      const parts = await database.selectFrom("analysis_parts").select(["id", "position", "kind", "status", "error_code", "created_at", "updated_at"]).where("run_id", "=", row.id).orderBy("position").execute();
      const result = await createAnalysisRepository(database, cipher).getRunResult({ runId: row.id, actor: actor(request) });
      response.json({ run: AnalysisRunDetailSchema.parse({ id: row.id, bookId: row.book_id, templateVersionId: row.template_version_id, jobId: row.job_id, mode: row.mode, startChapter: row.start_chapter, endChapter: row.end_chapter, status: row.status, completedParts: row.completed_parts, totalParts: row.total_parts, parts: parts.map((part) => ({ id: part.id, position: part.position, kind: part.kind, status: part.status, errorCode: part.error_code, createdAt: part.created_at.toISOString(), updatedAt: part.updated_at.toISOString() })), result, diagnostics: [], createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() }) });
    } catch (error) { handle(error, response, next); }
  });
  router.delete("/:bookId/advanced-analysis/:runId", ...csrf, async (request: AuthenticatedRequest, response, next) => {
    const params = paramsSchema.safeParse(request.params); const body = emptySchema.safeParse(request.body ?? {}); if (!params.success || !params.data.runId || !body.success) { response.status(400).json({ error: "invalid_request" }); return; }
    try { const run = await database.selectFrom("analysis_runs").select("book_id").where("id", "=", params.data.runId).where("created_by", "=", request.auth!.userId).executeTakeFirst(); if (!run || run.book_id !== params.data.bookId) throw new AnalysisNotFoundError(); await jobs.hardDelete({ runId: params.data.runId, actor: actor(request) }); response.status(204).end(); } catch (error) { handle(error, response, next); }
  });
  return router;
}
