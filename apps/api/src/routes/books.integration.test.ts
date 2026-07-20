import { createHash } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDisposablePostgres, type DisposablePostgres } from "../../../../packages/database/src/testing/postgres.js";
import { createApp } from "../app.js";
import type { ApiConfig } from "../config.js";
import { FakeFeishuOAuthAdapter } from "../auth/feishu-fake.js";
import { createContentCipher, createIndexRepository, createLibraryRepository } from "@novel-analysis/database";
import { buildImportSourceVersion } from "@novel-analysis/jobs";

const config: ApiConfig = { appOrigin: "http://app.test", oauthRedirectUri: "http://app.test/api/auth/callback", sessionCookieName: "session", oauthCorrelationCookieName: "correlation", sessionCookieSecure: false, sessionTtlMs: 3_600_000 };

describe("book routes", () => {
  let postgres: DisposablePostgres;
  let cookie: string;
  const csrf = "csrf";
  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    const user = await postgres.db.insertInto("users").values({ display_name: "member", avatar_url: null, role: "member", status: "active" }).returning("id").executeTakeFirstOrThrow();
    await postgres.db.insertInto("sessions").values({ user_id: user.id, token_hash: createHash("sha256").update("token").digest("hex"), csrf_token_hash: createHash("sha256").update(csrf).digest("hex"), expires_at: new Date(Date.now() + 60_000), revoked_at: null }).execute();
    cookie = "session=token";
  });
  afterEach(async () => postgres.destroy());
  const app = () => createApp({ database: postgres.db, config, feishu: new FakeFeishuOAuthAdapter() });
  const mutate = (path: string) => request(app()).post(path).set("Cookie", cookie).set("Origin", config.appOrigin).set("X-CSRF-Token", csrf);

  it("creates and reads a book, previews import and creates an idempotent job", async () => {
    const created = await mutate("/api/books").set("Idempotency-Key", "book-1").send({ title: "Novel", source: { provider: "dify", sourceId: "1", startChapter: 1, endChapter: 2 } });
    expect(created.status).toBe(201);
    const id = created.body.book.id as string;
    expect((await request(app()).get("/api/books").set("Cookie", cookie)).body.books).toHaveLength(1);
    expect((await request(app()).get(`/api/books/${id}`).set("Cookie", cookie)).body.book.title).toBe("Novel");
    const preview = await mutate(`/api/books/${id}/import-preview`).send({});
    expect(preview.body).toMatchObject({ requested: 2, executable: 2 });
    const job = await mutate(`/api/books/${id}/import-jobs`).set("Idempotency-Key", "import-1").send({ scopeHash: preview.body.scopeHash, autoStartL1: true });
    expect(job.status).toBe(201);
    const replay = await mutate(`/api/books/${id}/import-jobs`).set("Idempotency-Key", "import-1").send({ scopeHash: preview.body.scopeHash, autoStartL1: true });
    expect(replay.body.job.id).toBe(job.body.job.id);
  });

  it("requires authentication, CSRF, idempotency and returns stable scope_changed", async () => {
    expect((await request(app()).get("/api/books")).status).toBe(401);
    expect((await mutate("/api/books").send({ title: "Book", source: { provider: "dify", sourceId: "s", startChapter: 1, endChapter: 1 } })).body).toEqual({ error: "invalid_request" });
    const created = await mutate("/api/books").set("Idempotency-Key", "book").send({ title: "Book", source: { provider: "dify", sourceId: "1", startChapter: 1, endChapter: 1 } });
    const changed = await mutate(`/api/books/${created.body.book.id}/import-jobs`).set("Idempotency-Key", "import").send({ scopeHash: "0".repeat(64), autoStartL1: false });
    expect(changed.status).toBe(409);
    expect(changed.body).toEqual({ error: "scope_changed" });
  });

  it.each([
    { provider: "other", sourceId: "1", startChapter: 1, endChapter: 1 },
    { provider: "dify", sourceId: "1", startChapter: 0, endChapter: 1 },
    { provider: "dify", sourceId: "1", startChapter: -1, endChapter: 1 },
    { provider: "dify", sourceId: "1", startChapter: 1.5, endChapter: 2 },
    { provider: "dify", sourceId: "1", startChapter: Number.MAX_SAFE_INTEGER + 1, endChapter: Number.MAX_SAFE_INTEGER + 1 },
    { provider: "dify", sourceId: "1", startChapter: 2, endChapter: 1 },
    { provider: "dify", sourceId: "1", startChapter: 1, endChapter: 3001 },
    { provider: "dify", sourceId: "1", startChapter: 10_000_001, endChapter: 10_000_001 },
  ])("rejects invalid source %# with zero book effects", async (source) => {
    const result = await mutate("/api/books").set("Idempotency-Key", crypto.randomUUID()).send({ title: "Invalid", source });
    expect(result.status).toBe(400);
    expect(await postgres.db.selectFrom("books").selectAll().execute()).toEqual([]);
  });

  it("accepts the explicit 3000 chapter upper bound", async () => {
    const result = await mutate("/api/books").set("Idempotency-Key", "max-range").send({ title: "Maximum", source: { provider: "dify", sourceId: "1", startChapter: 1, endChapter: 3000 } });
    expect(result.status).toBe(201);
  });

  it("reports L1 coverage, previews the exact scope, and creates an idempotent L1 job", async () => {
    const created = await mutate("/api/books").set("Idempotency-Key", "l1-book").send({ title: "L1 Book", source: { provider: "dify", sourceId: "1", startChapter: 1, endChapter: 2 } });
    const bookId = created.body.book.id as string;
    const cipher = createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 3) } });
    const library = createLibraryRepository(postgres.db, cipher);
    await library.insertChapter({ bookId, chapterIndex: 1, title: "One", plaintext: "secret-one", contentHmac: "h1", sourceVersion: "source-v1" });
    await library.insertChapter({ bookId, chapterIndex: 2, title: "Two", plaintext: "secret-two", contentHmac: "h2", sourceVersion: "source-v1" });
    const indexes = createIndexRepository(postgres.db, cipher);
    const prompt = "L1 route prompt";
    await indexes.createPromptVersion({ target: "l1-index", version: "v1", content: prompt, contentHash: createHash("sha256").update(prompt).digest("hex") });
    await indexes.createWorkflowVersion({ target: "l1-index", contractVersion: "adapter-v1", dslHash: "workflow-v1" });

    const coverage = await request(app()).get(`/api/books/${bookId}/l1-coverage`).set("Cookie", cookie);
    expect(coverage.status).toBe(200);
    expect(coverage.body).toEqual({ total: 2, fresh: 0, missing: 2, failed: 0, stale: 0 });
    const preview = await mutate(`/api/books/${bookId}/l1-preview`).send({});
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ total: 2, missing: 2, executable: 2, scopeHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const createdJob = await mutate(`/api/books/${bookId}/l1-jobs`).set("Idempotency-Key", "l1-request").send({ scopeHash: preview.body.scopeHash });
    expect(createdJob.status).toBe(201);
    const replay = await mutate(`/api/books/${bookId}/l1-jobs`).set("Idempotency-Key", "l1-request").send({ scopeHash: preview.body.scopeHash });
    expect(replay.body.job.id).toBe(createdJob.body.job.id);
    expect(JSON.stringify({ coverage: coverage.body, preview: preview.body, response: createdJob.body })).not.toContain(prompt);
    expect(JSON.stringify({ coverage: coverage.body, preview: preview.body, response: createdJob.body })).not.toContain("secret-");
  });

  it("rejects changed L1 scope and empty Prompt configuration without creating effects", async () => {
    const created = await mutate("/api/books").set("Idempotency-Key", "invalid-l1-book").send({ title: "Invalid L1", source: { provider: "dify", sourceId: "1", startChapter: 1, endChapter: 1 } });
    const bookId = created.body.book.id as string;
    const cipher = createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 3) } });
    await createLibraryRepository(postgres.db, cipher).insertChapter({ bookId, chapterIndex: 1, title: "One", plaintext: "secret", contentHmac: "h1", sourceVersion: "source-v1" });
    await postgres.db.insertInto("prompt_versions").values({ target: "l1-index", version: "legacy", content: "", content_hash: "legacy" }).execute();
    await createIndexRepository(postgres.db, cipher).createWorkflowVersion({ target: "l1-index", contractVersion: "adapter-v1", dslHash: "workflow-v1" });
    const invalid = await mutate(`/api/books/${bookId}/l1-preview`).send({});
    expect(invalid.status).toBe(409);
    expect(invalid.body).toEqual({ error: "l1_configuration_invalid" });
    expect(await postgres.db.selectFrom("jobs").select("id").execute()).toEqual([]);

    await postgres.db.deleteFrom("prompt_versions").where("target", "=", "l1-index").execute();
    const prompt = "valid prompt";
    await createIndexRepository(postgres.db, cipher).createPromptVersion({ target: "l1-index", version: "valid", content: prompt, contentHash: createHash("sha256").update(prompt).digest("hex") });
    const preview = await mutate(`/api/books/${bookId}/l1-preview`).send({});
    await postgres.db.updateTable("chapters").set({ content_hmac: "changed" }).where("book_id", "=", bookId).execute();
    const changed = await mutate(`/api/books/${bookId}/l1-jobs`).set("Idempotency-Key", "changed-l1").send({ scopeHash: preview.body.scopeHash });
    expect(changed.status).toBe(409);
    expect(changed.body).toEqual({ error: "scope_changed" });
    expect(await postgres.db.selectFrom("jobs").select("id").execute()).toEqual([]);
  });

  it("returns a stable configuration error when completed import auto-handoff has no usable L1 Prompt", async () => {
    const source = { provider: "dify" as const, sourceId: "1", startChapter: 1, endChapter: 1 };
    const created = await mutate("/api/books").set("Idempotency-Key", "auto-invalid-l1").send({ title: "Auto Invalid L1", source });
    const bookId = created.body.book.id as string;
    const cipher = createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 3) } });
    await createLibraryRepository(postgres.db, cipher).insertChapter({ bookId, chapterIndex: 1, title: "One", plaintext: "secret", contentHmac: "h1", sourceVersion: buildImportSourceVersion(source) });
    await postgres.db.insertInto("prompt_versions").values({ target: "l1-index", version: "legacy", content: "", content_hash: "legacy" }).execute();
    await createIndexRepository(postgres.db, cipher).createWorkflowVersion({ target: "l1-index", contractVersion: "adapter-v1", dslHash: "workflow-v1" });
    const preview = await mutate(`/api/books/${bookId}/import-preview`).send({});
    expect(preview.body.executable).toBe(0);

    const result = await mutate(`/api/books/${bookId}/import-jobs`).set("Idempotency-Key", "auto-invalid-l1-job").send({ scopeHash: preview.body.scopeHash, autoStartL1: true });

    expect(result.status).toBe(409);
    expect(result.body).toEqual({ error: "l1_configuration_invalid" });
    expect(await postgres.db.selectFrom("jobs").select("id").execute()).toEqual([]);
    expect(await postgres.db.selectFrom("job_steps").select("id").execute()).toEqual([]);
    expect(await postgres.db.selectFrom("job_events").select("id").execute()).toEqual([]);
    expect(await postgres.db.selectFrom("job_outbox").select("id").execute()).toEqual([]);
  });
});
