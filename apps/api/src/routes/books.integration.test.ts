import { createHash } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDisposablePostgres, type DisposablePostgres } from "../../../../packages/database/src/testing/postgres.js";
import { createApp } from "../app.js";
import type { ApiConfig } from "../config.js";
import { FakeFeishuOAuthAdapter } from "../auth/feishu-fake.js";

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
});
