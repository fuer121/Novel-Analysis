import { createHash, timingSafeEqual } from "node:crypto";

import { Router, type CookieOptions } from "express";
import { z } from "zod";

import type { DatabaseConnection } from "@novel-analysis/database";

import type { ApiConfig } from "../config.js";
import { AuthError, AuthService, CsrfError } from "../auth/auth-service.js";
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

function correlationCookieOptions(config: ApiConfig): CookieOptions {
  return { ...baseCookieOptions(config), maxAge: 5 * 60 * 1000 };
}

function matchesCorrelation(state: string, correlation: string): boolean {
  const stateHash = createHash("sha256").update(state).digest();
  const correlationHash = createHash("sha256").update(correlation).digest();
  return timingSafeEqual(stateHash, correlationHash);
}

export function createAuthRouter(options: AuthRouterOptions): Router {
  const router = Router();
  const service = new AuthService(options);

  router.get("/login", async (request, response, next) => {
    try {
      const parsed = loginQuerySchema.safeParse(request.query);
      const url = await service.startLogin(parsed.success ? parsed.data.returnTo ?? "/" : "/");
      const state = url.searchParams.get("state");
      if (!state) throw new Error("authorization URL missing state");
      response.cookie(
        options.config.oauthCorrelationCookieName,
        state,
        correlationCookieOptions(options.config),
      );
      response.redirect(302, url.toString());
    } catch {
      next(new Error("login initialization failed"));
    }
  });

  router.get("/callback", async (request, response) => {
    const correlation = readCookie(request, options.config.oauthCorrelationCookieName);
    response.clearCookie(
      options.config.oauthCorrelationCookieName,
      baseCookieOptions(options.config),
    );
    const parsed = callbackQuerySchema.safeParse(request.query);
    if (!parsed.success || !correlation || !matchesCorrelation(parsed.data.state, correlation)) {
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
    } catch (error) {
      if (error instanceof AuthError) {
        response.status(401).json({ error: "unauthorized" });
        return;
      }
      options.logger.error("Current session lookup failed");
      response.status(500).json({ error: "internal_error" });
    }
  });

  router.post("/logout", async (request, response, next) => {
    if (request.get("Origin") !== options.config.appOrigin) {
      response.status(403).json({ error: "forbidden" });
      return;
    }
    const token = readCookie(request, options.config.sessionCookieName);
    if (!token) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }
    const csrfToken = request.get("X-CSRF-Token");
    if (!csrfToken) {
      response.status(403).json({ error: "forbidden" });
      return;
    }
    try {
      await service.logout(token, csrfToken);
      response.clearCookie(options.config.sessionCookieName, baseCookieOptions(options.config));
      response.status(204).end();
    } catch (error) {
      if (error instanceof AuthError) {
        response.status(401).json({ error: "unauthorized" });
        return;
      }
      if (error instanceof CsrfError) {
        response.status(403).json({ error: "forbidden" });
        return;
      }
      next(new Error("logout failed"));
    }
  });

  return router;
}
