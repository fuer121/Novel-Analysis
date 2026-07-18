import { Router, type CookieOptions } from "express";
import { z } from "zod";

import type { DatabaseConnection } from "@novel-analysis/database";

import type { ApiConfig } from "../config.js";
import { AuthError, AuthService } from "../auth/auth-service.js";
import { requireCsrf } from "../auth/csrf.js";
import type { FeishuOAuthAdapter } from "../auth/feishu-adapter.js";
import { readCookie } from "../auth/session-middleware.js";

const loginQuerySchema = z.object({ returnTo: z.string().optional() }).passthrough();
const callbackQuerySchema = z.object({
  code: z.string().min(1).max(4096),
  state: z.string().min(1).max(4096),
}).passthrough();

export interface AuthRouteLogger {
  error(message: string): void;
}

export interface AuthRouterOptions {
  database: DatabaseConnection;
  config: ApiConfig;
  feishu: FeishuOAuthAdapter;
  logger: AuthRouteLogger;
}

function baseCookieOptions(config: ApiConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: config.sessionCookieSecure,
    sameSite: "lax",
    path: "/",
  };
}

function cookieOptions(config: ApiConfig): CookieOptions {
  return { ...baseCookieOptions(config), maxAge: config.sessionTtlMs };
}

export function createAuthRouter(options: AuthRouterOptions): Router {
  const router = Router();
  const service = new AuthService(options);

  router.get("/login", async (request, response, next) => {
    try {
      const parsed = loginQuerySchema.safeParse(request.query);
      const url = await service.startLogin(parsed.success ? parsed.data.returnTo ?? "/" : "/");
      response.redirect(302, url.toString());
    } catch {
      next(new Error("login initialization failed"));
    }
  });

  router.get("/callback", async (request, response) => {
    const parsed = callbackQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(401).json({ error: "authentication_failed" });
      return;
    }
    try {
      const result = await service.finishLogin(
        parsed.data.code,
        parsed.data.state,
        readCookie(request, options.config.sessionCookieName),
      );
      response.cookie(options.config.sessionCookieName, result.sessionToken, cookieOptions(options.config));
      response.redirect(303, result.returnTo);
    } catch (error) {
      options.logger.error("OAuth callback failed");
      response.status(error instanceof AuthError ? 401 : 500).json({
        error: error instanceof AuthError ? "authentication_failed" : "internal_error",
      });
    }
  });

  router.get("/me", async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (
      request.get("Sec-Fetch-Site") === "cross-site"
      || (request.get("Origin") !== undefined && request.get("Origin") !== options.config.appOrigin)
    ) {
      response.status(403).json({ error: "forbidden" });
      return;
    }
    const token = readCookie(request, options.config.sessionCookieName);
    if (!token) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }
    try {
      response.json(await service.currentUserAndRotateCsrf(token));
    } catch {
      response.status(401).json({ error: "unauthorized" });
    }
  });

  router.post("/logout", ...requireCsrf(options.database, options.config), async (request, response, next) => {
    const token = readCookie(request, options.config.sessionCookieName);
    try {
      if (token) await service.logout(token);
      response.clearCookie(options.config.sessionCookieName, baseCookieOptions(options.config));
      response.status(204).end();
    } catch {
      next(new Error("logout failed"));
    }
  });

  return router;
}
