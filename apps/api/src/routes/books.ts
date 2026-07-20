import { Router, type Response } from "express";
import { sql } from "kysely";
import { z } from "zod";

import { BookSummarySchema, JobResponseSchema } from "@novel-analysis/contracts";
import type { DatabaseConnection } from "@novel-analysis/database";
import { BookNotFoundError, IdempotencyConflictError, ImportJobService, MAX_IMPORT_CHAPTER_INDEX, MAX_IMPORT_CHAPTERS, ScopeChangedError } from "@novel-analysis/jobs";

import { requireCsrf } from "../auth/csrf.js";
import { type AuthenticatedRequest, requireSession } from "../auth/session-middleware.js";
import type { ApiConfig } from "../config.js";

const idSchema = z.object({ id: z.uuid() }).strict();
const keySchema = z.string().trim().min(1).max(200);
const createSchema = z.strictObject({
  title: z.string().trim().min(1).max(500),
  source: z.strictObject({ provider: z.literal("dify"), sourceId: z.string().regex(/^[1-9]\d*$/).max(500), startChapter: z.number().safe().int().positive().max(MAX_IMPORT_CHAPTER_INDEX), endChapter: z.number().safe().int().positive().max(MAX_IMPORT_CHAPTER_INDEX) }),
}).superRefine((value, context) => {
  if (value.source.endChapter < value.source.startChapter || value.source.endChapter - value.source.startChapter + 1 > MAX_IMPORT_CHAPTERS) context.addIssue({ code: "custom", path: ["source", "endChapter"], message: "invalid import range" });
});
const createJobSchema = z.strictObject({ scopeHash: z.string().regex(/^[a-f0-9]{64}$/), autoStartL1: z.boolean() });

function idempotencyKey(request: AuthenticatedRequest, response: Response): string | null {
  const parsed = keySchema.safeParse(request.get("Idempotency-Key"));
  if (!parsed.success) {
    response.status(400).json({ error: "invalid_request" });
    return null;
  }
  return parsed.data;
}

function publicBook(row: { id: string; title: string; status: "active" | "archived"; created_at: Date; chapter_count: number | string }) {
  return BookSummarySchema.parse({ id: row.id, title: row.title, status: row.status, chapterCount: Number(row.chapter_count), createdAt: row.created_at.toISOString() });
}

export function createBooksRouter(database: DatabaseConnection, config: ApiConfig): Router {
  const router = Router();
  const session = requireSession(database, config);
  const csrf = requireCsrf(database, config);
  const jobs = new ImportJobService(database);

  router.post("/", ...csrf, async (request: AuthenticatedRequest, response, next) => {
    const key = idempotencyKey(request, response);
    const body = createSchema.safeParse(request.body);
    if (!key || !body.success) {
      if (!response.headersSent) response.status(400).json({ error: "invalid_request" });
      return;
    }
    try {
      const book = await database.transaction().execute(async (transaction) => {
        await sql`select pg_advisory_xact_lock(hashtext(${`${request.auth!.userId}:${key}`}))`.execute(transaction);
        const audit = await transaction.selectFrom("audit_logs").select("target_id")
          .where("actor_user_id", "=", request.auth!.userId).where("action", "=", "book.create")
          .where(sql<boolean>`metadata ->> 'requestId' = ${key}`).executeTakeFirst();
        if (audit) {
          const existing = await transaction.selectFrom("books as b").leftJoin("chapters as c", "c.book_id", "b.id")
            .select(["b.id", "b.title", "b.status", "b.created_at"]).select(({ fn }) => fn.count<number>("c.id").as("chapter_count"))
            .where("b.id", "=", audit.target_id).groupBy("b.id").executeTakeFirstOrThrow();
          return publicBook(existing);
        }
        const inserted = await transaction.insertInto("books").values({ title: body.data.title, status: "active", created_by: request.auth!.userId }).returning(["id", "title", "status", "created_at"]).executeTakeFirstOrThrow();
        await transaction.insertInto("book_sources").values({ book_id: inserted.id, provider: body.data.source.provider, source_id: body.data.source.sourceId, start_chapter: body.data.source.startChapter, end_chapter: body.data.source.endChapter }).execute();
        await transaction.insertInto("audit_logs").values({ actor_user_id: request.auth!.userId, action: "book.create", target_type: "book", target_id: inserted.id, metadata: { requestId: key } }).execute();
        return publicBook({ ...inserted, chapter_count: 0 });
      });
      response.status(201).json({ book });
    } catch {
      next(new Error("book creation failed"));
    }
  });

  router.get("/", session, async (_request, response, next) => {
    try {
      const rows = await database.selectFrom("books as b").leftJoin("chapters as c", "c.book_id", "b.id")
        .select(["b.id", "b.title", "b.status", "b.created_at"]).select(({ fn }) => fn.count<number>("c.id").as("chapter_count"))
        .groupBy("b.id").orderBy("b.created_at", "desc").execute();
      response.json({ books: rows.map(publicBook) });
    } catch { next(new Error("book list failed")); }
  });

  router.get("/:id", session, async (request, response, next) => {
    const params = idSchema.safeParse(request.params);
    if (!params.success) { response.status(400).json({ error: "invalid_request" }); return; }
    try {
      const row = await database.selectFrom("books as b").leftJoin("chapters as c", "c.book_id", "b.id")
        .select(["b.id", "b.title", "b.status", "b.created_at"]).select(({ fn }) => fn.count<number>("c.id").as("chapter_count"))
        .where("b.id", "=", params.data.id).groupBy("b.id").executeTakeFirst();
      if (!row) { response.status(404).json({ error: "book_not_found" }); return; }
      response.json({ book: publicBook(row) });
    } catch { next(new Error("book detail failed")); }
  });

  router.post("/:id/import-preview", ...csrf, async (request, response, next) => {
    const params = idSchema.safeParse(request.params);
    if (!params.success || Object.keys((request.body ?? {}) as object).length > 0) { response.status(400).json({ error: "invalid_request" }); return; }
    try { response.json(await jobs.preview({ bookId: params.data.id })); }
    catch (error) {
      if (error instanceof BookNotFoundError) { response.status(404).json({ error: "book_not_found" }); return; }
      next(new Error("import preview failed"));
    }
  });

  router.post("/:id/import-jobs", ...csrf, async (request: AuthenticatedRequest, response, next) => {
    const params = idSchema.safeParse(request.params);
    const key = idempotencyKey(request, response);
    const body = createJobSchema.safeParse(request.body);
    if (!params.success || !key || !body.success) { if (!response.headersSent) response.status(400).json({ error: "invalid_request" }); return; }
    try {
      const job = await jobs.create({ bookId: params.data.id, requestedBy: request.auth!.userId, requestId: key, scopeHash: body.data.scopeHash, autoStartL1: body.data.autoStartL1 });
      response.status(201).json(JobResponseSchema.parse({ job }));
    } catch (error) {
      if (error instanceof ScopeChangedError) { response.status(409).json({ error: "scope_changed" }); return; }
      if (error instanceof IdempotencyConflictError) { response.status(409).json({ error: "idempotency_conflict" }); return; }
      if (error instanceof BookNotFoundError) { response.status(404).json({ error: "book_not_found" }); return; }
      next(new Error("import job creation failed"));
    }
  });
  return router;
}
