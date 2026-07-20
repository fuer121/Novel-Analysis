import { createHash } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createContentCipher, createIndexRepository, createLibraryRepository } from "@novel-analysis/database";
import { createDisposablePostgres, type DisposablePostgres } from "../../../../packages/database/src/testing/postgres.js";

import { createApp } from "../app.js";
import { FakeFeishuOAuthAdapter } from "../auth/feishu-fake.js";
import type { ApiConfig } from "../config.js";

const config: ApiConfig = { appOrigin: "http://app.test", oauthRedirectUri: "http://app.test/api/auth/callback", sessionCookieName: "session", oauthCorrelationCookieName: "correlation", sessionCookieSecure: false, sessionTtlMs: 3_600_000 };
const cipher = createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 6) } });

describe("index group routes", () => {
  let postgres: DisposablePostgres;
  let cookie: string;
  let bookId: string;
  let promptVersionId: string;
  const csrf = "csrf";

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    const user = await postgres.db.insertInto("users").values({ display_name: "member", avatar_url: null, role: "member", status: "active" }).returning("id").executeTakeFirstOrThrow();
    await postgres.db.insertInto("sessions").values({ user_id: user.id, token_hash: createHash("sha256").update("token").digest("hex"), csrf_token_hash: createHash("sha256").update(csrf).digest("hex"), expires_at: new Date(Date.now() + 60_000), revoked_at: null }).execute();
    cookie = "session=token";
    bookId = (await createLibraryRepository(postgres.db, cipher).createBook({ title: "Book", createdBy: user.id })).id;
    const indexes = createIndexRepository(postgres.db, cipher);
    const promptContent = "Extract people facts";
    promptVersionId = (await indexes.createPromptVersion({ target: "l2-index", version: "people-v1", content: promptContent, contentHash: createHash("sha256").update(promptContent).digest("hex") })).id;
    await indexes.createWorkflowVersion({ target: "l2-index", contractVersion: "adapter-v1", dslHash: "workflow-v1" });
    const library = createLibraryRepository(postgres.db, cipher);
    await library.insertChapter({ bookId, chapterIndex: 1, title: "One", plaintext: "secret-one", contentHmac: "h1", sourceVersion: "source-v1" });
    await library.insertChapter({ bookId, chapterIndex: 2, title: "Two", plaintext: "secret-two", contentHmac: "h2", sourceVersion: "source-v1" });
  });

  afterEach(async () => postgres.destroy());
  const app = () => createApp({ database: postgres.db, config, feishu: new FakeFeishuOAuthAdapter() });
  const mutate = (path: string) => request(app()).post(path).set("Cookie", cookie).set("Origin", config.appOrigin).set("X-CSRF-Token", csrf);

  it("creates and lists a group, reports coverage, previews scope and creates an idempotent job", async () => {
    const created = await mutate(`/api/books/${bookId}/index-groups`).send({ key: "people", name: "People", categoryScope: "general", promptVersionId });
    expect(created.status).toBe(201);
    expect(created.body.indexGroup).toMatchObject({ key: "people", name: "People", categoryScope: "general", promptVersionId, configHash: expect.stringMatching(/^[a-f0-9]{64}$/), status: "active" });
    const groupId = created.body.indexGroup.id as string;

    const listed = await request(app()).get(`/api/books/${bookId}/index-groups`).set("Cookie", cookie);
    expect(listed.body.indexGroups).toHaveLength(1);
    const coverage = await request(app()).get(`/api/books/${bookId}/index-groups/${groupId}/coverage`).set("Cookie", cookie);
    expect(coverage.body).toEqual({ total: 2, fresh: 0, missing: 2, failed: 0, stale: 0 });
    const preview = await mutate(`/api/books/${bookId}/index-groups/${groupId}/l2-preview`).send({ startChapter: 1, endChapter: 2, mode: "missing", force: false });
    expect(preview.body).toMatchObject({ total: 2, executable: 2, skipped: 0, scopeHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const job = await mutate(`/api/books/${bookId}/index-groups/${groupId}/l2-jobs`).set("Idempotency-Key", "l2-job").send({ startChapter: 1, endChapter: 2, mode: "missing", force: false, scopeHash: preview.body.scopeHash });
    expect(job.status).toBe(201);
    const replay = await mutate(`/api/books/${bookId}/index-groups/${groupId}/l2-jobs`).set("Idempotency-Key", "l2-job").send({ startChapter: 1, endChapter: 2, mode: "missing", force: false, scopeHash: preview.body.scopeHash });
    expect(replay.body.job.id).toBe(job.body.job.id);
    const steps = await postgres.db.selectFrom("job_steps as s").innerJoin("chapters as c", (join) => join.on("c.book_id", "=", bookId).onRef("c.chapter_index", "=", "s.position")).select(["c.id as chapter_id", "s.input_signature"]).where("s.job_id", "=", job.body.job.id).execute();
    const indexes = createIndexRepository(postgres.db, cipher);
    for (const step of steps) await indexes.putL2ChapterStatus({ groupId, chapterId: step.chapter_id, inputSignature: step.input_signature, status: "fresh" });
    expect((await request(app()).get(`/api/books/${bookId}/index-groups/${groupId}/coverage`).set("Cookie", cookie)).body).toEqual({ total: 2, fresh: 2, missing: 0, failed: 0, stale: 0 });
    await indexes.createWorkflowVersion({ target: "l2-index", contractVersion: "adapter-v2", dslHash: "workflow-v2" });
    expect((await request(app()).get(`/api/books/${bookId}/index-groups/${groupId}/coverage`).set("Cookie", cookie)).body).toEqual({ total: 2, fresh: 0, missing: 0, failed: 0, stale: 2 });
    expect(JSON.stringify({ created: created.body, listed: listed.body, coverage: coverage.body, preview: preview.body, job: job.body })).not.toContain("Extract people facts");
    expect(JSON.stringify(job.body)).not.toContain("secret-");
  });

  it("requires auth and CSRF, rejects duplicate groups and does not expose an edit endpoint", async () => {
    expect((await request(app()).get(`/api/books/${bookId}/index-groups`)).status).toBe(401);
    expect((await request(app()).post(`/api/books/${bookId}/index-groups`).set("Cookie", cookie).send({ key: "people", name: "People", categoryScope: "general", promptVersionId })).status).toBe(403);
    expect((await mutate(`/api/books/${bookId}/index-groups`).send({ key: "people", name: "People", categoryScope: "general", promptVersionId })).status).toBe(201);
    const duplicate = await mutate(`/api/books/${bookId}/index-groups`).send({ key: "people", name: "Changed", categoryScope: "general", promptVersionId });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toEqual({ error: "index_group_exists" });
    expect((await request(app()).patch(`/api/books/${bookId}/index-groups/${crypto.randomUUID()}`).set("Cookie", cookie).set("Origin", config.appOrigin).set("X-CSRF-Token", csrf).send({ name: "Changed" })).status).toBe(404);
  });
});
