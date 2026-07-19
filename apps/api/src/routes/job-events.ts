import { Router } from "express";
import { sql } from "kysely";

import { JobEventSchema, type JobEvent } from "@novel-analysis/contracts";
import type { DatabaseConnection } from "@novel-analysis/database";

import type { ApiConfig } from "../config.js";
import { type AuthenticatedRequest, requireSession } from "../auth/session-middleware.js";

const POLL_INTERVAL_MS = 1_000;
const internalPayloadKeys = new Set([
  "attemptId",
  "configSnapshot",
  "concurrencyKey",
  "idempotencyKey",
  "leaseExpiresAt",
  "leaseOwner",
  "queueId",
  "requestId",
  "tokenHash",
  "workerId",
]);

interface SseWritable {
  destroyed: boolean;
  writableEnded: boolean;
  write(chunk: string): boolean;
  once(event: "drain" | "error", listener: () => void): unknown;
  off(event: "drain" | "error", listener: () => void): unknown;
}

export function writeSseChunk(
  response: SseWritable,
  chunk: string,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted || response.destroyed || response.writableEnded) {
    return Promise.resolve(false);
  }
  if (response.write(chunk)) return Promise.resolve(true);
  if (response.destroyed || response.writableEnded) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (written: boolean) => {
      if (settled) return;
      settled = true;
      response.off("drain", onDrain);
      response.off("error", onClosed);
      signal.removeEventListener("abort", onClosed);
      resolve(written);
    };
    const onDrain = () => finish(true);
    const onClosed = () => finish(false);
    response.once("drain", onDrain);
    response.once("error", onClosed);
    signal.addEventListener("abort", onClosed, { once: true });
    if (signal.aborted || response.destroyed || response.writableEnded) onClosed();
  });
}

function waitForNextPoll(signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => finish(true), POLL_INTERVAL_MS);
    const finish = (ready: boolean) => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resolve(ready);
    };
    const onAbort = () => finish(false);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function parseCursor(value: string | undefined): number | null {
  if (value === undefined) return 0;
  if (!/^\d+$/.test(value)) return null;
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) ? cursor : null;
}

function publicValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !internalPayloadKeys.has(key))
      .map(([key, nestedValue]) => [key, publicValue(nestedValue)]),
  );
}

function publicPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return publicValue(payload) as Record<string, unknown>;
}

function eventJson(row: {
  id: string;
  job_id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: Date;
}): JobEvent {
  return JobEventSchema.parse({
    id: Number(row.id),
    jobId: row.job_id,
    type: row.type,
    createdAt: row.created_at.toISOString(),
    payload: publicPayload(row.payload),
  });
}

export function createJobEventsRouter(
  database: DatabaseConnection,
  config: ApiConfig,
): Router {
  const router = Router();
  const session = requireSession(database, config);

  router.get("/", session, async (request: AuthenticatedRequest, response) => {
    const headerCursor = request.get("Last-Event-ID");
    const search = new URL(request.originalUrl, "http://api.local").searchParams;
    const afterValues = search.getAll("after");
    const hasStructuredAfter = [...search.keys()].some(
      (key) => key === "after[]" || key.startsWith("after["),
    );
    if (headerCursor === undefined && (afterValues.length > 1 || hasStructuredAfter)) {
      response.status(400).json({ error: "invalid_request" });
      return;
    }
    const queryCursor = afterValues[0];
    let cursor = parseCursor(headerCursor ?? queryCursor);
    if (cursor === null) {
      response.status(400).json({ error: "invalid_request" });
      return;
    }

    response.status(200);
    response.set({
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    });
    response.flushHeaders();

    const connection = new AbortController();
    const closeConnection = () => connection.abort();
    request.once("close", closeConnection);
    response.once("close", closeConnection);
    response.once("error", closeConnection);

    try {
      while (!connection.signal.aborted) {
        const activeSession = await database.selectFrom("sessions")
          .innerJoin("users", "users.id", "sessions.user_id")
          .select("sessions.id")
          .where("sessions.id", "=", request.auth!.sessionId)
          .where("sessions.user_id", "=", request.auth!.userId)
          .where("sessions.revoked_at", "is", null)
          .where("sessions.expires_at", ">", sql<Date>`now()`)
          .where("users.status", "=", "active")
          .executeTakeFirst();
        if (connection.signal.aborted) return;
        if (!activeSession) {
          response.end();
          return;
        }
        try {
          const rows = await database.selectFrom("job_events")
            .select(["id", "job_id", "type", "payload", "created_at"])
            .where("id", ">", String(cursor))
            .orderBy("id", "asc")
            .limit(100)
            .execute();
          for (const row of rows) {
            const event = eventJson(row);
            const written = await writeSseChunk(
              response,
              `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`,
              connection.signal,
            );
            if (!written) return;
            cursor = event.id;
          }
        } catch {
          response.destroy();
          return;
        }
        if (!await waitForNextPoll(connection.signal)) return;
      }
    } finally {
      request.off("close", closeConnection);
      response.off("close", closeConnection);
      response.off("error", closeConnection);
    }
  });

  return router;
}
