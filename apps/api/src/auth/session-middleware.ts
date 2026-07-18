import { sql } from "kysely";
import type { NextFunction, Request, Response } from "express";

import type { DatabaseConnection } from "@novel-analysis/database";
import type { Role } from "@novel-analysis/domain";

import type { ApiConfig } from "../config.js";
import { sha256 } from "./oauth-state-repository.js";

export interface SessionIdentity {
  sessionId: string;
  userId: string;
  displayName: string;
  role: Role;
}

export interface AuthenticatedRequest extends Request {
  auth?: SessionIdentity;
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

export function requireSession(database: DatabaseConnection, config: ApiConfig) {
  return async (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    const token = readCookie(request, config.sessionCookieName);
    if (!token) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }
    try {
      const row = await database.selectFrom("sessions")
        .innerJoin("users", "users.id", "sessions.user_id")
        .select([
          "sessions.id as sessionId",
          "users.id as userId",
          "users.display_name as displayName",
          "users.role as role",
        ])
        .where("sessions.token_hash", "=", sha256(token))
        .where("sessions.revoked_at", "is", null)
        .where("sessions.expires_at", ">", sql<Date>`now()`)
        .where("users.status", "=", "active")
        .executeTakeFirst();
      if (!row) {
        response.status(401).json({ error: "unauthorized" });
        return;
      }
      request.auth = row;
      next();
    } catch {
      next(new Error("session lookup failed"));
    }
  };
}
