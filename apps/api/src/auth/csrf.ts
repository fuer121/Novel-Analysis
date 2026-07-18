import { createHash, timingSafeEqual } from "node:crypto";

import type { NextFunction, Response } from "express";

import type { DatabaseConnection } from "@novel-analysis/database";

import type { ApiConfig } from "../config.js";
import { type AuthenticatedRequest, requireSession } from "./session-middleware.js";

export function matchesCsrfHash(rawToken: string, expectedHash: string): boolean {
  const actual = createHash("sha256").update(rawToken).digest();
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function requireCsrf(database: DatabaseConnection, config: ApiConfig) {
  const session = requireSession(database, config);
  return [
    (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
      if (request.get("Origin") !== config.appOrigin) {
        response.status(403).json({ error: "forbidden" });
        return;
      }
      session(request, response, next);
    },
    async (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
      const rawToken = request.get("X-CSRF-Token");
      if (!rawToken || !request.auth) {
        response.status(403).json({ error: "forbidden" });
        return;
      }
      try {
        const row = await database.selectFrom("sessions")
          .select("csrf_token_hash")
          .where("id", "=", request.auth.sessionId)
          .executeTakeFirst();
        if (!row?.csrf_token_hash || !matchesCsrfHash(rawToken, row.csrf_token_hash)) {
          response.status(403).json({ error: "forbidden" });
          return;
        }
        next();
      } catch {
        next(new Error("CSRF validation failed"));
      }
    },
  ] as const;
}
