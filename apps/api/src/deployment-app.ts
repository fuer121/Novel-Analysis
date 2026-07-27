import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";

import { sql } from "@novel-analysis/database";
import express, { type Express } from "express";

import { createApp, type CreateAppOptions } from "./app.js";

export interface CreateDeploymentAppOptions extends CreateAppOptions {
  readinessProbe?: () => Promise<void>;
  webStaticDir?: string;
}

function isApiPath(path: string): boolean {
  return path === "/api" || path.startsWith("/api/");
}

export function createDeploymentApp(options: CreateDeploymentAppOptions): Express {
  const app = express();
  const readinessProbe = options.readinessProbe ?? (async () => {
    await sql`select 1`.execute(options.database);
    if (options.webStaticDir) {
      await access(join(options.webStaticDir, "index.html"), constants.R_OK);
    }
  });

  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.set({
      "Content-Security-Policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    next();
  });
  app.get("/api/health/live", (_request, response) => {
    response.json({ status: "ok" });
  });
  app.get("/api/health/ready", async (_request, response) => {
    try {
      await readinessProbe();
      response.json({ status: "ready" });
    } catch {
      response.status(503).json({ status: "unavailable" });
    }
  });
  if (options.webStaticDir) {
    const staticFiles = express.static(options.webStaticDir, { index: "index.html" });
    app.use((request, response, next) => {
      if (isApiPath(request.path)) {
        next();
        return;
      }
      staticFiles(request, response, next);
    });
    app.use((request, response, next) => {
      if (!isApiPath(request.path) && ["GET", "HEAD"].includes(request.method) && request.accepts("html")) {
        response.sendFile("index.html", { root: options.webStaticDir }, (error) => {
          if (error) next(error);
        });
        return;
      }
      next();
    });
  }
  app.use(createApp(options));
  return app;
}
