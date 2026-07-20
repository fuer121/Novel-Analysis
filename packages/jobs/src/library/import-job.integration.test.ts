import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createContentCipher, createLibraryRepository } from "@novel-analysis/database";
import { createDisposablePostgres, type DisposablePostgres } from "../../../database/src/testing/postgres.js";

import { buildImportSourceVersion, IdempotencyConflictError, ImportJobService, InvalidImportScopeError, ScopeChangedError } from "./import-job.js";

describe("chapter import job", () => {
  let postgres: DisposablePostgres;
  let userId: string;
  let bookId: string;

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    userId = (await postgres.db.insertInto("users").values({ display_name: "member", avatar_url: null, role: "member", status: "active" }).returning("id").executeTakeFirstOrThrow()).id;
    const library = createLibraryRepository(postgres.db, createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 1) } }));
    bookId = (await library.createBook({ title: "Book", createdBy: userId })).id;
    await library.upsertSource({ bookId, provider: "dify", sourceId: "source-1", startChapter: 1, endChapter: 3 });
    await library.insertChapter({ bookId, chapterIndex: 1, title: "Fresh", plaintext: "fresh", contentHmac: "h1", sourceVersion: buildImportSourceVersion({ provider: "dify", sourceId: "source-1", startChapter: 1, endChapter: 3 }) });
    await library.insertChapter({ bookId, chapterIndex: 2, title: "Stale", plaintext: "stale", contentHmac: "h2", sourceVersion: "old" });
  });

  afterEach(async () => postgres.destroy());

  it("uses one selector for preview and creation and rejects a changed scope without effects", async () => {
    const service = new ImportJobService(postgres.db);
    const preview = await service.preview({ bookId });
    expect(preview).toMatchObject({ requested: 3, existingFresh: 1, existingStale: 1, executable: 2 });
    expect(preview.scopeHash).toMatch(/^[a-f0-9]{64}$/);

    await postgres.db.updateTable("book_sources").set({ end_chapter: 4 }).where("book_id", "=", bookId).execute();
    await expect(service.create({ bookId, requestedBy: userId, requestId: "changed", scopeHash: preview.scopeHash, autoStartL1: false })).rejects.toBeInstanceOf(ScopeChangedError);
    expect(await postgres.db.selectFrom("jobs").select(({ fn }) => fn.countAll<number>().as("count")).executeTakeFirstOrThrow()).toEqual({ count: "0" });
  });

  it("atomically creates one step per executable chapter and reuses idempotent or concurrent requests", async () => {
    const service = new ImportJobService(postgres.db);
    const preview = await service.preview({ bookId });
    const [first, concurrent] = await Promise.all([
      service.create({ bookId, requestedBy: userId, requestId: "request-1", scopeHash: preview.scopeHash, autoStartL1: true }),
      service.create({ bookId, requestedBy: userId, requestId: "request-2", scopeHash: preview.scopeHash, autoStartL1: true }),
    ]);
    const replay = await service.create({ bookId, requestedBy: userId, requestId: "request-1", scopeHash: preview.scopeHash, autoStartL1: true });
    expect(replay.id).toBe(first.id);
    expect(concurrent.id).toBe(first.id);
    expect(await postgres.db.selectFrom("job_steps").select(["position", "kind"]).where("job_id", "=", first.id).orderBy("position").execute()).toEqual([
      { position: 2, kind: "chapter-import" },
      { position: 3, kind: "chapter-import" },
    ]);
    expect(await postgres.db.selectFrom("job_events").select("type").where("job_id", "=", first.id).execute()).toEqual([{ type: "created" }]);
    expect(await postgres.db.selectFrom("job_outbox").select("topic").where("job_id", "=", first.id).execute()).toEqual([{ topic: "jobs.wake" }]);
    expect(JSON.stringify(await postgres.db.selectFrom("jobs").selectAll().where("id", "=", first.id).executeTakeFirstOrThrow())).not.toContain("fresh");
  });

  it("namespaces keys by import book and rejects replay with changed frozen semantics", async () => {
    const library = createLibraryRepository(postgres.db, createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 1) } }));
    const otherBook = (await library.createBook({ title: "Other", createdBy: userId })).id;
    await library.upsertSource({ bookId: otherBook, provider: "dify", sourceId: "2", startChapter: 1, endChapter: 1 });
    const service = new ImportJobService(postgres.db);
    const firstPreview = await service.preview({ bookId });
    const otherPreview = await service.preview({ bookId: otherBook });
    const first = await service.create({ bookId, requestedBy: userId, requestId: "shared", scopeHash: firstPreview.scopeHash, autoStartL1: false });
    const other = await service.create({ bookId: otherBook, requestedBy: userId, requestId: "shared", scopeHash: otherPreview.scopeHash, autoStartL1: false });
    expect(other.id).not.toBe(first.id);
    expect((await service.create({ bookId, requestedBy: userId, requestId: "shared", scopeHash: firstPreview.scopeHash, autoStartL1: false })).id).toBe(first.id);
    await expect(service.create({ bookId, requestedBy: userId, requestId: "shared", scopeHash: firstPreview.scopeHash, autoStartL1: true })).rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(service.create({ bookId, requestedBy: userId, requestId: "different-key", scopeHash: firstPreview.scopeHash, autoStartL1: true })).rejects.toBeInstanceOf(IdempotencyConflictError);
    const version = buildImportSourceVersion({ provider: "dify", sourceId: "source-1", startChapter: 1, endChapter: 3 });
    await postgres.db.updateTable("chapters").set({ source_version: version }).where("book_id", "=", bookId).where("chapter_index", "=", 2).execute();
    await createLibraryRepository(postgres.db, createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 1) } })).insertChapter({ bookId, chapterIndex: 3, title: "Three", plaintext: "three", contentHmac: "h3", sourceVersion: version });
    const freshnessChanged = await service.preview({ bookId });
    await expect(service.create({ bookId, requestedBy: userId, requestId: "shared", scopeHash: freshnessChanged.scopeHash, autoStartL1: false })).rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(service.create({ bookId, requestedBy: userId, requestId: "freshness-active", scopeHash: freshnessChanged.scopeHash, autoStartL1: false })).rejects.toBeInstanceOf(IdempotencyConflictError);
    await postgres.db.updateTable("book_sources").set({ end_chapter: 2 }).where("book_id", "=", bookId).execute();
    const changedPreview = await service.preview({ bookId });
    await expect(service.create({ bookId, requestedBy: userId, requestId: "shared", scopeHash: changedPreview.scopeHash, autoStartL1: false })).rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(service.create({ bookId, requestedBy: userId, requestId: "range-active", scopeHash: changedPreview.scopeHash, autoStartL1: false })).rejects.toBeInstanceOf(IdempotencyConflictError);
    await postgres.db.updateTable("jobs").set({ status: "completed" }).where("id", "=", first.id).execute();
    await postgres.db.insertInto("jobs").values({ type: "query", status: "completed", requested_by: userId, request_id: "collision", scope: { bookId }, config_snapshot: {}, concurrency_key: null, progress: { total: 0, completed: 0, failed: 0, skipped: 0, current: "" } }).execute();
    expect((await service.create({ bookId, requestedBy: userId, requestId: "collision", scopeHash: changedPreview.scopeHash, autoStartL1: false })).type).toBe("import");
  });

  it("rejects invalid ranges and providers before allocating scope or creating effects", async () => {
    const service = new ImportJobService(postgres.db);
    const invalid = [
      { provider: "other", start: 1, end: 1 },
      { provider: "dify", start: 1, end: 3001 },
      { provider: "dify", start: 9_999_999, end: 10_000_001 },
    ];
    for (const value of invalid) {
      await postgres.db.updateTable("book_sources").set({ provider: value.provider, start_chapter: value.start, end_chapter: value.end }).where("book_id", "=", bookId).execute();
      await expect(service.preview({ bookId })).rejects.toBeInstanceOf(InvalidImportScopeError);
    }
    await postgres.db.updateTable("book_sources").set({ provider: "dify", start_chapter: 1, end_chapter: 3000 }).where("book_id", "=", bookId).execute();
    expect((await service.preview({ bookId })).requested).toBe(3000);
    expect(await postgres.db.selectFrom("jobs").selectAll().execute()).toEqual([]);
  });

  it("linearizes scope recheck behind the book lock", async () => {
    const service = new ImportJobService(postgres.db);
    const preview = await service.preview({ bookId });
    let locked!: () => void;
    const hasLock = new Promise<void>((resolve) => { locked = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const holder = postgres.db.transaction().execute(async (transaction) => {
      await transaction.selectFrom("books").select("id").where("id", "=", bookId).forUpdate().executeTakeFirstOrThrow();
      locked();
      await gate;
      const version = buildImportSourceVersion({ provider: "dify", sourceId: "source-1", startChapter: 1, endChapter: 3 });
      await createLibraryRepository(transaction, createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 1) } })).insertChapter({ bookId, chapterIndex: 3, title: "Three", plaintext: "three", contentHmac: "h3", sourceVersion: version });
    });
    await hasLock;
    const creating = service.create({ bookId, requestedBy: userId, requestId: "locked", scopeHash: preview.scopeHash, autoStartL1: false });
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    await holder;
    await expect(creating).rejects.toBeInstanceOf(ScopeChangedError);
    expect(await postgres.db.selectFrom("jobs").selectAll().execute()).toEqual([]);
  });

  it("creates one L1 handoff when an explicitly automatic import is already complete", async () => {
    const version = buildImportSourceVersion({ provider: "dify", sourceId: "source-1", startChapter: 1, endChapter: 3 });
    await postgres.db.deleteFrom("chapters").where("book_id", "=", bookId).where("chapter_index", "=", 2).execute();
    const library = createLibraryRepository(postgres.db, createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 1) } }));
    await library.insertChapter({ bookId, chapterIndex: 2, title: "Two", plaintext: "two", contentHmac: "h2", sourceVersion: version });
    await library.insertChapter({ bookId, chapterIndex: 3, title: "Three", plaintext: "three", contentHmac: "h3", sourceVersion: version });
    const service = new ImportJobService(postgres.db);
    const preview = await service.preview({ bookId });
    expect(preview.executable).toBe(0);
    const job = await service.create({ bookId, requestedBy: userId, requestId: "complete", scopeHash: preview.scopeHash, autoStartL1: true });
    expect(job.status).toBe("completed");
    expect(await postgres.db.selectFrom("jobs").select("id").where("type", "=", "l1-index").execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("job_outbox").selectAll().where("job_id", "=", job.id).execute()).toEqual([]);
  });
});
