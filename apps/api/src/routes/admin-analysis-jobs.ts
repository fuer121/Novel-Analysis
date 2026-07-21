import { Router } from "express";
import { z } from "zod";

import { AdminAnalysisRunMetadataSchema } from "@novel-analysis/contracts";
import type { DatabaseConnection } from "@novel-analysis/database";
import { InvalidJobTransitionError } from "@novel-analysis/domain";
import { JobControls, JobNotFoundError } from "@novel-analysis/jobs";

import { requireCsrf } from "../auth/csrf.js";
import { type AuthenticatedRequest, requireSession } from "../auth/session-middleware.js";
import type { ApiConfig } from "../config.js";

const paramsSchema = z.strictObject({ runId: z.uuid() });
const controlSchema = z.strictObject({ action: z.enum(["pause", "resume", "cancel"]), requestId: z.string().trim().min(1).max(200) });
const metadata = (row: { id: string; job_id: string; book_id: string; created_by: string; mode: "fast_index" | "balanced" | "precision" | "full_text"; status: "queued" | "running" | "retrying" | "paused" | "completed" | "failed" | "cancelled"; completed_parts: number; total_parts: number; error_code: string | null; created_at: Date; updated_at: Date }) => AdminAnalysisRunMetadataSchema.parse({ id: row.id, jobId: row.job_id, bookId: row.book_id, createdBy: row.created_by, mode: row.mode, status: row.status, completedParts: row.completed_parts, totalParts: row.total_parts, errorCode: row.error_code, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });

export function createAdminAnalysisJobsRouter(database: DatabaseConnection, config: ApiConfig): Router {
  const router = Router(); const session = requireSession(database, config); const csrf = requireCsrf(database, config); const controls = new JobControls(database);
  router.get("/", session, async (request: AuthenticatedRequest, response) => {
    if (request.auth!.role !== "admin") { response.status(404).json({ error: "not_found" }); return; }
    const rows = await database.selectFrom("analysis_runs").select(["id", "job_id", "book_id", "created_by", "mode", "status", "completed_parts", "total_parts", "error_code", "created_at", "updated_at"]).orderBy("created_at", "desc").limit(100).execute(); response.json({ runs: rows.map(metadata) });
  });
  router.post("/:runId/control", ...csrf, async (request: AuthenticatedRequest, response, next) => {
    const params = paramsSchema.safeParse(request.params); const body = controlSchema.safeParse(request.body); if (!params.success || !body.success) { response.status(400).json({ error: "invalid_request" }); return; }
    if (request.auth!.role !== "admin") { response.status(404).json({ error: "not_found" }); return; }
    try { const run = await database.selectFrom("analysis_runs").select("job_id").where("id", "=", params.data.runId).executeTakeFirst(); if (!run) { response.status(404).json({ error: "not_found" }); return; } response.json({ job: await controls.control({ jobId: run.job_id, actor: { userId: request.auth!.userId, role: "admin" }, action: body.data.action, requestId: body.data.requestId }) }); } catch (error) { if (error instanceof JobNotFoundError) { response.status(404).json({ error: "not_found" }); return; } if (error instanceof InvalidJobTransitionError) { response.status(409).json({ error: "invalid_transition" }); return; } next(new Error("Admin analysis control failed")); }
  });
  return router;
}
