import { Router } from "express";
import { z } from "zod";

import type { DatabaseConnection } from "@novel-analysis/database";
import {
  LibraryRebuildConflictError,
  LibraryRebuildJobService,
  LibraryRebuildNotFoundError,
  LibraryRebuildPositionOverflowError,
} from "@novel-analysis/jobs";

import { requireCsrf } from "../auth/csrf.js";
import { type AuthenticatedRequest, requireSession } from "../auth/session-middleware.js";
import type { ApiConfig } from "../config.js";

const emptyBodySchema = z.strictObject({});
const jobParamsSchema = z.strictObject({ jobId: z.uuid() });
const reorderSchema = z.strictObject({
  orderedStepIds: z.array(z.uuid()).min(1).refine(
    (ids) => new Set(ids).size === ids.length,
    "orderedStepIds must be unique",
  ),
});

function adminOnly(request: AuthenticatedRequest, response: {
  status(code: number): { json(body: unknown): unknown };
}): boolean {
  if (request.auth!.role === "admin") return true;
  response.status(404).json({ error: "not_found" });
  return false;
}

export function createAdminRebuildRouter(
  database: DatabaseConnection,
  config: ApiConfig,
): Router {
  const router = Router();
  const session = requireSession(database, config);
  const csrf = requireCsrf(database, config);
  const service = new LibraryRebuildJobService(database);

  router.get("/current", session, async (request: AuthenticatedRequest, response, next) => {
    if (!adminOnly(request, response)) return;
    try {
      const latest = await database.selectFrom("jobs").select("id")
        .where("type", "=", "library-rebuild")
        .orderBy("created_at", "desc").orderBy("id", "desc").executeTakeFirst();
      response.json({ detail: latest ? await service.get(latest.id) : null });
    } catch {
      next(new Error("Admin rebuild lookup failed"));
    }
  });

  router.get("/:jobId", session, async (request: AuthenticatedRequest, response, next) => {
    if (!adminOnly(request, response)) return;
    const params = jobParamsSchema.safeParse(request.params);
    if (!params.success) {
      response.status(400).json({ error: "invalid_request" });
      return;
    }
    try {
      const result = await service.get(params.data.jobId);
      if (!result) {
        response.status(404).json({ error: "not_found" });
        return;
      }
      response.json({ detail: result });
    } catch {
      next(new Error("Admin rebuild lookup failed"));
    }
  });

  router.post("/", ...csrf, async (request: AuthenticatedRequest, response, next) => {
    if (!adminOnly(request, response)) return;
    const body = emptyBodySchema.safeParse(request.body);
    const requestId = z.string().trim().min(1).max(200)
      .safeParse(request.get("Idempotency-Key"));
    if (!body.success || !requestId.success) {
      response.status(400).json({ error: "invalid_request" });
      return;
    }
    try {
      const job = await service.create({
        requestedBy: request.auth!.userId,
        requestId: requestId.data,
      });
      response.status(201).json({ detail: await service.get(job.id) });
    } catch (error) {
      if (error instanceof LibraryRebuildConflictError) {
        response.status(409).json({ error: "rebuild_conflict" });
        return;
      }
      next(new Error("Admin rebuild creation failed"));
    }
  });

  router.put("/:jobId/order", ...csrf, async (request: AuthenticatedRequest, response, next) => {
    if (!adminOnly(request, response)) return;
    const params = jobParamsSchema.safeParse(request.params);
    const body = reorderSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      response.status(400).json({ error: "invalid_request" });
      return;
    }
    try {
      const result = await service.reorder({
        jobId: params.data.jobId,
        orderedStepIds: body.data.orderedStepIds,
        actorUserId: request.auth!.userId,
      });
      response.json({ detail: result });
    } catch (error) {
      if (error instanceof LibraryRebuildNotFoundError) {
        response.status(404).json({ error: "not_found" });
        return;
      }
      if (error instanceof LibraryRebuildConflictError
        || error instanceof LibraryRebuildPositionOverflowError) {
        response.status(409).json({ error: "rebuild_not_reorderable" });
        return;
      }
      next(new Error("Admin rebuild reorder failed"));
    }
  });

  return router;
}
