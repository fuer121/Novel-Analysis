import express, { type ErrorRequestHandler, type Express } from "express";

import type { DatabaseConnection } from "@novel-analysis/database";

import { assertCookieConfig, type ApiConfig } from "./config.js";
import type { FeishuOAuthAdapter } from "./auth/feishu-adapter.js";
import { createAdminMembersRouter } from "./routes/admin-members.js";
import { createAuthRouter, type AuthRouteLogger } from "./routes/auth.js";
import { createJobEventsRouter } from "./routes/job-events.js";
import { createJobsRouter } from "./routes/jobs.js";

export interface CreateAppOptions {
  database: DatabaseConnection;
  config: ApiConfig;
  feishu: FeishuOAuthAdapter;
  logger?: AuthRouteLogger;
}

export function createApp(options: CreateAppOptions): Express {
  assertCookieConfig(options.config);
  const app = express();
  const logger = options.logger ?? { error: (_message: string) => undefined };

  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb", strict: true }));
  app.use("/api/auth", createAuthRouter({ ...options, logger }));
  app.use("/api/admin/members", createAdminMembersRouter(options.database, options.config));
  app.use("/api/job-events", createJobEventsRouter(options.database, options.config));
  app.use("/api/jobs", createJobsRouter(options.database, options.config));
  app.use((_request, response) => response.status(404).json({ error: "not_found" }));

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    if (error instanceof SyntaxError && "status" in error && error.status === 400) {
      response.status(400).json({ error: "invalid_request" });
      return;
    }
    logger.error("Request failed");
    response.status(500).json({ error: "internal_error" });
  };
  app.use(errorHandler);
  return app;
}
