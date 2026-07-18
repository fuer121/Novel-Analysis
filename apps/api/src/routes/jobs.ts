import { Router, type Response } from "express";
import { z } from "zod";

import {
  JobListQuerySchema,
  JobListResponseSchema,
  JobResponseSchema,
} from "@novel-analysis/contracts";
import type { DatabaseConnection } from "@novel-analysis/database";
import { InvalidJobTransitionError } from "@novel-analysis/domain";
import {
  InvalidJobCursorError,
  JobControlForbiddenError,
  JobControls,
  JobNotFoundError,
  JobRepository,
  type JobControlAction,
} from "@novel-analysis/jobs";

import type { ApiConfig } from "../config.js";
import { requireCsrf } from "../auth/csrf.js";
import {
  type AuthenticatedRequest,
  requireSession,
} from "../auth/session-middleware.js";

const jobParamsSchema = z.object({ id: z.uuid() }).strict();
const idempotencyKeySchema = z.string().trim().min(1).max(200);

function readIdempotencyKey(
  request: AuthenticatedRequest,
  response: Response,
): string | null {
  const parsed = idempotencyKeySchema.safeParse(request.get("Idempotency-Key"));
  if (!parsed.success) {
    response.status(400).json({ error: "invalid_request" });
    return null;
  }
  return parsed.data;
}

export function createJobsRouter(
  database: DatabaseConnection,
  config: ApiConfig,
): Router {
  const router = Router();
  const repository = new JobRepository(database);
  const controls = new JobControls(database);
  const session = requireSession(database, config);
  const csrf = requireCsrf(database, config);

  router.post("/example", ...csrf, async (request: AuthenticatedRequest, response, next) => {
    const requestId = readIdempotencyKey(request, response);
    if (!requestId) return;
    try {
      const job = await repository.createExample({
        requestedBy: request.auth!.userId,
        requestId,
      });
      response.status(201).json(JobResponseSchema.parse({ job }));
    } catch {
      next(new Error("job creation failed"));
    }
  });

  router.get("/", session, async (request, response, next) => {
    const query = JobListQuerySchema.safeParse(request.query);
    if (!query.success) {
      response.status(400).json({ error: "invalid_request" });
      return;
    }
    try {
      const result = await repository.list(query.data);
      response.json(JobListResponseSchema.parse(result));
    } catch (error) {
      if (error instanceof InvalidJobCursorError) {
        response.status(400).json({ error: "invalid_request" });
        return;
      }
      next(new Error("job list failed"));
    }
  });

  router.get("/:id", session, async (request, response, next) => {
    const params = jobParamsSchema.safeParse(request.params);
    if (!params.success) {
      response.status(400).json({ error: "invalid_request" });
      return;
    }
    try {
      const job = await repository.getById(params.data.id);
      if (!job) {
        response.status(404).json({ error: "job_not_found" });
        return;
      }
      response.json(JobResponseSchema.parse({ job }));
    } catch {
      next(new Error("job detail failed"));
    }
  });

  async function control(
    action: JobControlAction,
    request: AuthenticatedRequest,
    response: Response,
    next: (error?: unknown) => void,
  ) {
    const params = jobParamsSchema.safeParse(request.params);
    const requestId = readIdempotencyKey(request, response);
    if (!params.success || !requestId) {
      if (!response.headersSent) response.status(400).json({ error: "invalid_request" });
      return;
    }
    try {
      const job = await controls.control({
        jobId: params.data.id,
        actor: {
          userId: request.auth!.userId,
          role: request.auth!.role,
        },
        action,
        requestId,
      });
      response.json(JobResponseSchema.parse({ job }));
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        response.status(404).json({ error: "job_not_found" });
        return;
      }
      if (error instanceof JobControlForbiddenError) {
        response.status(403).json({ error: "forbidden" });
        return;
      }
      if (error instanceof InvalidJobTransitionError) {
        response.status(409).json({ error: "invalid_transition" });
        return;
      }
      next(new Error("job control failed"));
    }
  }

  router.post("/:id/pause", ...csrf, (request, response, next) => {
    void control("pause", request, response, next);
  });
  router.post("/:id/resume", ...csrf, (request, response, next) => {
    void control("resume", request, response, next);
  });
  router.post("/:id/cancel", ...csrf, (request, response, next) => {
    void control("cancel", request, response, next);
  });

  return router;
}
