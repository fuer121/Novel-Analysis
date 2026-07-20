import { createHash } from "node:crypto";
import { Router, type Response } from "express";
import { z } from "zod";

import { JobResponseSchema } from "@novel-analysis/contracts";
import type { DatabaseConnection } from "@novel-analysis/database";
import {
  L2BookNotFoundError,
  L2ConfigurationError,
  L2IdempotencyConflictError,
  L2IndexGroupNotFoundError,
  L2JobService,
  L2ScopeChangedError,
  L2_ADMISSION_VERSION,
  L2_FACT_SCHEMA_VERSION,
} from "@novel-analysis/jobs";

import { requireCsrf } from "../auth/csrf.js";
import { type AuthenticatedRequest, requireSession } from "../auth/session-middleware.js";
import type { ApiConfig } from "../config.js";

const identifiers = z.strictObject({ bookId: z.uuid(), groupId: z.uuid().optional() });
const createSchema = z.strictObject({ key: z.string().trim().min(1).max(200), name: z.string().trim().min(1).max(500), promptVersionId: z.uuid() });
const scopeSchema = z.strictObject({ startChapter: z.number().safe().int().positive(), endChapter: z.number().safe().int().positive(), mode: z.enum(["all", "missing", "retry_failed"]), force: z.boolean() }).refine((value) => value.endChapter >= value.startChapter, { path: ["endChapter"] });
const createJobSchema = scopeSchema.extend({ scopeHash: z.string().regex(/^[a-f0-9]{64}$/) });
const keySchema = z.string().trim().min(1).max(200);

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function idempotencyKey(request: AuthenticatedRequest, response: Response): string | null {
  const parsed = keySchema.safeParse(request.get("Idempotency-Key"));
  if (!parsed.success) { response.status(400).json({ error: "invalid_request" }); return null; }
  return parsed.data;
}

function publicGroup(row: { id: string; key: string; name: string; prompt_version_id: string; config_hash: string; status: "active" | "archived" }) {
  return { id: row.id, key: row.key, name: row.name, promptVersionId: row.prompt_version_id, configHash: row.config_hash, status: row.status };
}

function handleL2Error(error: unknown, response: Response, next: (error: Error) => void): void {
  if (error instanceof L2BookNotFoundError) { response.status(404).json({ error: "book_not_found" }); return; }
  if (error instanceof L2IndexGroupNotFoundError) { response.status(404).json({ error: "index_group_not_found" }); return; }
  if (error instanceof L2ConfigurationError) { response.status(409).json({ error: "l2_configuration_invalid" }); return; }
  if (error instanceof L2ScopeChangedError) { response.status(409).json({ error: "scope_changed" }); return; }
  if (error instanceof L2IdempotencyConflictError) { response.status(409).json({ error: "idempotency_conflict" }); return; }
  next(new Error("L2 index group request failed"));
}

export function createIndexGroupsRouter(database: DatabaseConnection, config: ApiConfig): Router {
  const router = Router();
  const session = requireSession(database, config);
  const csrf = requireCsrf(database, config);
  const jobs = new L2JobService(database);

  router.post("/:bookId/index-groups", ...csrf, async (request: AuthenticatedRequest, response, next) => {
    const params = identifiers.safeParse(request.params);
    const body = createSchema.safeParse(request.body);
    if (!params.success || !body.success) { response.status(400).json({ error: "invalid_request" }); return; }
    try {
      const group = await database.transaction().execute(async (transaction) => {
        const book = await transaction.selectFrom("books").select("id").where("id", "=", params.data.bookId).where("status", "=", "active").forUpdate().executeTakeFirst();
        if (!book) throw new L2BookNotFoundError();
        const prompt = await transaction.selectFrom("prompt_versions").select(["id", "content_hash"]).where("id", "=", body.data.promptVersionId).where("target", "=", "l2-index").executeTakeFirst();
        if (!prompt) throw new L2ConfigurationError();
        const configHash = hash({ key: body.data.key, name: body.data.name, promptVersionId: prompt.id, promptHash: prompt.content_hash, schemaVersion: L2_FACT_SCHEMA_VERSION, admissionVersion: L2_ADMISSION_VERSION });
        const inserted = await transaction.insertInto("index_groups").values({ book_id: params.data.bookId, key: body.data.key, name: body.data.name, prompt_version_id: prompt.id, config_hash: configHash }).returning(["id", "key", "name", "prompt_version_id", "config_hash", "status"]).executeTakeFirstOrThrow();
        await transaction.insertInto("audit_logs").values({ actor_user_id: request.auth!.userId, action: "index_group.create", target_type: "index_group", target_id: inserted.id, metadata: { bookId: params.data.bookId, key: inserted.key, promptVersionId: prompt.id, configHash } }).execute();
        return publicGroup(inserted);
      });
      response.status(201).json({ indexGroup: group });
    } catch (error) {
      if ((error as { code?: string; constraint?: string }).code === "23505" && (error as { constraint?: string }).constraint === "index_groups_book_id_key_unique") {
        response.status(409).json({ error: "index_group_exists" });
        return;
      }
      handleL2Error(error, response, next);
    }
  });

  router.get("/:bookId/index-groups", session, async (request, response, next) => {
    const params = identifiers.safeParse(request.params);
    if (!params.success) { response.status(400).json({ error: "invalid_request" }); return; }
    try {
      const book = await database.selectFrom("books").select("id").where("id", "=", params.data.bookId).where("status", "=", "active").executeTakeFirst();
      if (!book) { response.status(404).json({ error: "book_not_found" }); return; }
      const groups = await database.selectFrom("index_groups").select(["id", "key", "name", "prompt_version_id", "config_hash", "status"]).where("book_id", "=", params.data.bookId).where("status", "=", "active").orderBy("created_at").orderBy("id").execute();
      response.json({ indexGroups: groups.map(publicGroup) });
    } catch { next(new Error("index group list failed")); }
  });

  router.get("/:bookId/index-groups/:groupId/coverage", session, async (request, response, next) => {
    const params = identifiers.safeParse(request.params);
    if (!params.success || !params.data.groupId) { response.status(400).json({ error: "invalid_request" }); return; }
    try {
      response.json(await jobs.coverage({ bookId: params.data.bookId, groupId: params.data.groupId }));
    } catch (error) { handleL2Error(error, response, next); }
  });

  router.post("/:bookId/index-groups/:groupId/l2-preview", ...csrf, async (request, response, next) => {
    const params = identifiers.safeParse(request.params);
    const body = scopeSchema.safeParse(request.body);
    if (!params.success || !params.data.groupId || !body.success) { response.status(400).json({ error: "invalid_request" }); return; }
    try { response.json(await jobs.preview({ bookId: params.data.bookId, groupId: params.data.groupId, ...body.data })); }
    catch (error) { handleL2Error(error, response, next); }
  });

  router.post("/:bookId/index-groups/:groupId/l2-jobs", ...csrf, async (request: AuthenticatedRequest, response, next) => {
    const params = identifiers.safeParse(request.params);
    const key = idempotencyKey(request, response);
    const body = createJobSchema.safeParse(request.body);
    if (!params.success || !params.data.groupId || !key || !body.success) { if (!response.headersSent) response.status(400).json({ error: "invalid_request" }); return; }
    try {
      const job = await jobs.create({ bookId: params.data.bookId, groupId: params.data.groupId, ...body.data, requestedBy: request.auth!.userId, requestId: key });
      response.status(201).json(JobResponseSchema.parse({ job }));
    } catch (error) { handleL2Error(error, response, next); }
  });

  return router;
}
