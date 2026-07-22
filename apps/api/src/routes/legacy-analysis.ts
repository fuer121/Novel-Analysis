import { Router } from "express";
import { z } from "zod";

import { LegacyAnalysisDetailSchema, LegacyAnalysisSummarySchema } from "@novel-analysis/contracts";
import type { DatabaseConnection } from "@novel-analysis/database";

import { type AuthenticatedRequest, requireSession } from "../auth/session-middleware.js";
import type { ApiConfig } from "../config.js";
import type { LegacyAnalysisReader } from "../legacy-analysis.js";

const paramsSchema = z.strictObject({ bookId: z.uuid(), analysisId: z.string().trim().min(1).max(500).optional() });

async function ownsBook(database: DatabaseConnection, request: AuthenticatedRequest, bookId: string): Promise<boolean> {
  if (request.auth!.role === "admin") return false;
  const book = await database.selectFrom("books").select("id").where("id", "=", bookId).where("created_by", "=", request.auth!.userId).where("status", "=", "active").executeTakeFirst();
  return Boolean(book);
}

export function createLegacyAnalysisRouter(database: DatabaseConnection, config: ApiConfig, reader: LegacyAnalysisReader): Router {
  const router = Router();
  const session = requireSession(database, config);

  router.get("/:bookId/legacy-analysis", session, async (request: AuthenticatedRequest, response, next) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) { response.status(400).json({ error: "invalid_request" }); return; }
    try {
      if (!await ownsBook(database, request, params.data.bookId)) { response.status(404).json({ error: "not_found" }); return; }
      const analyses = (await reader.list({ bookId: params.data.bookId, actorId: request.auth!.userId })).map((analysis) => {
        const parsed = LegacyAnalysisSummarySchema.parse(analysis);
        if (parsed.bookId !== params.data.bookId) throw new Error("Legacy analysis reader returned a mismatched book");
        return parsed;
      });
      response.json({ analyses });
    } catch { next(new Error("Legacy analysis list failed")); }
  });

  router.get("/:bookId/legacy-analysis/:analysisId", session, async (request: AuthenticatedRequest, response, next) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success || !params.data.analysisId) { response.status(400).json({ error: "invalid_request" }); return; }
    try {
      if (!await ownsBook(database, request, params.data.bookId)) { response.status(404).json({ error: "not_found" }); return; }
      const analysis = await reader.get({ bookId: params.data.bookId, analysisId: params.data.analysisId, actorId: request.auth!.userId });
      if (!analysis || analysis.bookId !== params.data.bookId || analysis.id !== params.data.analysisId) { response.status(404).json({ error: "not_found" }); return; }
      response.json({ analysis: LegacyAnalysisDetailSchema.parse(analysis) });
    } catch { next(new Error("Legacy analysis detail failed")); }
  });

  return router;
}
