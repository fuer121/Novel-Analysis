import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "kysely";
import request from "supertest";

import { AnalysisScopePreviewSchema } from "@novel-analysis/contracts";
import { createContentCipher, createIndexRepository, createLibraryRepository } from "@novel-analysis/database";
import { createDisposablePostgres, type DisposablePostgres } from "../../../../packages/database/src/testing/postgres.js";

import { createApp } from "../app.js";
import { FakeFeishuOAuthAdapter } from "../auth/feishu-fake.js";
import type { ApiConfig } from "../config.js";

const cipher = createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 21) } });
const config: ApiConfig = { appOrigin: "http://analysis.test", oauthRedirectUri: "http://analysis.test/api/auth/callback", sessionCookieName: "analysis_session", oauthCorrelationCookieName: "analysis_oauth", sessionCookieSecure: false, sessionTtlMs: 60_000 };

describe("advanced analysis routes", () => {
  let postgres: DisposablePostgres; let bookId: string; let groupId: string;
  const identities: Record<string, { id: string; cookie: string; csrf: string }> = {};
  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    for (const [name, role] of [["owner", "member"], ["member", "member"], ["admin", "admin"]] as const) {
      const user = await postgres.db.insertInto("users").values({ display_name: name, role, status: "active" }).returning("id").executeTakeFirstOrThrow(); const token = `${name}-token`; const csrf = `${name}-csrf`;
      await postgres.db.insertInto("sessions").values({ user_id: user.id, token_hash: createHash("sha256").update(token).digest("hex"), csrf_token_hash: createHash("sha256").update(csrf).digest("hex"), expires_at: new Date(Date.now() + 60_000), revoked_at: null }).execute(); identities[name] = { id: user.id, cookie: `analysis_session=${token}`, csrf };
    }
    const library = createLibraryRepository(postgres.db, cipher); const indexes = createIndexRepository(postgres.db, cipher);
    bookId = (await library.createBook({ title: "Book", createdBy: identities.owner!.id })).id;
    const prompt = await indexes.createPromptVersion({ target: "l2-index", version: "v1", content: "index", contentHash: createHash("sha256").update("index").digest("hex") });
    groupId = (await indexes.createIndexGroup({ bookId, key: "people", name: "People", categoryScope: "general", promptVersionId: prompt.id, configHash: "group-v1" })).id;
    await indexes.createWorkflowVersion({ target: "analysis-summary", contractVersion: "summary-v1", dslHash: "dsl-v1" });
    for (let chapterIndex = 1; chapterIndex <= 2; chapterIndex += 1) await library.insertChapter({ bookId, chapterIndex, title: `C${chapterIndex}`, plaintext: `SENTINEL_CHAPTER_${chapterIndex}`, contentHmac: `h-${chapterIndex}`, sourceVersion: "source" });
  });
  afterEach(async () => postgres.destroy());
  const app = () => createApp({ database: postgres.db, config, feishu: new FakeFeishuOAuthAdapter(), contentCipher: cipher });
  const auth = (name: string) => ({ Cookie: identities[name]!.cookie });
  const write = (name: string) => ({ ...auth(name), Origin: config.appOrigin, "X-CSRF-Token": identities[name]!.csrf });

  it("keeps template content owner-private and exposes owner run list and detail", async () => {
    const templateResponse = await request(app()).post(`/api/books/${bookId}/analysis-templates`).set(write("owner")).send({ bookId, name: "Private", prompt: "SENTINEL_PROMPT", outputSchema: { value: "SENTINEL_SCHEMA" }, indexGroupId: groupId });
    expect(templateResponse.status).toBe(201); const templateId = templateResponse.body.template.id as string;
    expect((await request(app()).get(`/api/books/${bookId}/analysis-templates/${templateId}`).set(auth("owner"))).body.template.prompt).toBe("SENTINEL_PROMPT");
    expect((await request(app()).get(`/api/books/${bookId}/analysis-templates/${templateId}`).set(auth("member"))).status).toBe(404);
    expect((await request(app()).get(`/api/books/${bookId}/analysis-templates/${templateId}`).set(auth("admin"))).status).toBe(404);
    const versioned = await request(app()).patch(`/api/books/${bookId}/analysis-templates/${templateId}`).set(write("owner")).send({ name: "Private v2", prompt: "SENTINEL_PROMPT_V2", outputSchema: { value: "SENTINEL_SCHEMA_V2" }, indexGroupId: groupId });
    expect(versioned.status).toBe(200); expect(versioned.body.template.currentVersionId).not.toBe(templateResponse.body.template.currentVersionId);
    const templates = await request(app()).get(`/api/books/${bookId}/analysis-templates`).set(auth("owner"));
    expect(templates.status).toBe(200); expect(templates.body.templates).toHaveLength(1); expect(JSON.stringify(templates.body)).not.toContain("SENTINEL_PROMPT");
    expect((await request(app()).get(`/api/books/${bookId}/analysis-templates`).set(auth("member"))).body).toEqual({ templates: [] });
    expect((await request(app()).get(`/api/books/${bookId}/analysis-templates`).set(auth("admin"))).body).toEqual({ templates: [] });
    const preview = await request(app()).post(`/api/books/${bookId}/advanced-analysis/preview`).set(write("owner")).send({ bookId, templateId, mode: "balanced", startChapter: 1, endChapter: 2 });
    expect(preview.status).toBe(200); expect(AnalysisScopePreviewSchema.parse(preview.body)).toEqual(preview.body);
    expect((await request(app()).post(`/api/books/${bookId}/advanced-analysis/preview`).set(write("member")).send({ bookId, templateId, mode: "balanced", startChapter: 1, endChapter: 2 })).status).toBe(404);
    expect((await request(app()).post(`/api/books/${bookId}/advanced-analysis/preview`).set(write("admin")).send({ bookId, templateId, mode: "balanced", startChapter: 1, endChapter: 2 })).status).toBe(404);
    expect((await request(app()).post(`/api/books/${bookId}/advanced-analysis/preview`).set(write("owner")).send({ bookId, templateId, mode: "unknown", startChapter: 1, endChapter: 2 })).status).toBe(400);
    expect((await request(app()).post(`/api/books/${bookId}/advanced-analysis/preview`).set(write("owner")).send({ bookId, templateId, mode: "balanced", startChapter: 2, endChapter: 1 })).status).toBe(400);
    const created = await request(app()).post(`/api/books/${bookId}/advanced-analysis`).set(write("owner")).send({ bookId, templateId, templateVersionId: preview.body.templateVersionId, mode: "balanced", startChapter: 1, endChapter: 2, scopeHash: preview.body.scopeHash, idempotencyKey: "api-create" });
    expect(created.status).toBe(201); const runId = created.body.run.id as string;
    const list = await request(app()).get(`/api/books/${bookId}/advanced-analysis`).set(auth("owner"));
    expect(list.status).toBe(200); expect(list.body.runs[0].id).toBe(runId);
    const detail = await request(app()).get(`/api/books/${bookId}/advanced-analysis/${runId}`).set(auth("owner"));
    expect(detail.status).toBe(200); expect(detail.body.run.parts).toHaveLength(2);
    expect((await request(app()).get(`/api/books/${bookId}/advanced-analysis/${runId}`).set(auth("member"))).status).toBe(404);
    expect((await request(app()).get(`/api/books/${bookId}/advanced-analysis/${runId}`).set(auth("admin"))).status).toBe(404);
    expect((await request(app()).delete(`/api/books/${bookId}/advanced-analysis/${runId}`).set(write("member")).send({})).status).toBe(404);
    expect((await request(app()).delete(`/api/books/${bookId}/advanced-analysis/${runId}`).set(write("admin")).send({})).status).toBe(404);
    const admin = await request(app()).get("/api/admin/advanced-analysis").set(auth("admin"));
    expect(admin.status).toBe(200); expect(admin.body.runs[0]).toMatchObject({ id: runId, createdBy: identities.owner!.id, bookId });
    expect(Object.keys(admin.body.runs[0]).sort()).toEqual(["bookId", "completedParts", "createdAt", "createdBy", "errorCode", "id", "jobId", "mode", "status", "totalParts", "updatedAt"].sort());
    expect(JSON.stringify(admin.body)).not.toMatch(/SENTINEL_(PROMPT|SCHEMA|CHAPTER)/);
    const controlled = await request(app()).post(`/api/admin/advanced-analysis/${runId}/control`).set(write("admin")).send({ action: "pause", requestId: "admin-pause" });
    expect(controlled.status).toBe(200); expect(controlled.body.job.status).toBe("paused"); expect(JSON.stringify(controlled.body)).not.toMatch(/SENTINEL_(PROMPT|SCHEMA|CHAPTER)/);
  });

  it("uses CSRF and strict contracts", async () => {
    expect((await request(app()).post(`/api/books/${bookId}/analysis-templates`).set(auth("owner")).send({})).status).toBe(403);
    expect((await request(app()).post(`/api/books/${bookId}/advanced-analysis/preview`).set(auth("owner")).send({})).status).toBe(403);
    expect((await request(app()).post(`/api/books/${bookId}/advanced-analysis/preview`).send({})).status).toBe(403);
    expect((await request(app()).get(`/api/books/${bookId}/analysis-templates`)).status).toBe(401);
    expect((await request(app()).post(`/api/books/${bookId}/analysis-templates`).set(write("owner")).send({ bookId, name: "x", prompt: "p", outputSchema: {}, indexGroupId: null, extra: true })).status).toBe(400);
  });

  it("hard deletes the complete terminal graph and retains only safe deletion audit", async () => {
    const template = await request(app()).post(`/api/books/${bookId}/analysis-templates`).set(write("owner")).send({ bookId, name: "Delete", prompt: "DELETE_PROMPT_SENTINEL", outputSchema: { secret: "DELETE_SCHEMA_SENTINEL" }, indexGroupId: groupId });
    const templateId = template.body.template.id as string;
    const preview = await request(app()).post(`/api/books/${bookId}/advanced-analysis/preview`).set(write("owner")).send({ bookId, templateId, mode: "balanced", startChapter: 1, endChapter: 2 });
    const created = await request(app()).post(`/api/books/${bookId}/advanced-analysis`).set(write("owner")).send({ bookId, templateId, templateVersionId: preview.body.templateVersionId, mode: "balanced", startChapter: 1, endChapter: 2, scopeHash: preview.body.scopeHash, idempotencyKey: "delete-graph" });
    const runId = created.body.run.id as string; const jobId = created.body.job.id as string;
    await postgres.db.updateTable("analysis_runs").set({ status: "cancelled" }).where("id", "=", runId).execute(); await postgres.db.updateTable("jobs").set({ status: "cancelled" }).where("id", "=", jobId).execute();
    expect((await request(app()).delete(`/api/books/${bookId}/advanced-analysis/${runId}`).set(write("owner")).send({})).status).toBe(204);
    const counts = await Promise.all(["analysis_runs", "analysis_parts", "jobs", "job_steps", "job_attempts", "job_events", "job_outbox"].map(async (table) => Number((await sql<{ count: string }>`select count(*)::text as count from ${sql.table(table)}`.execute(postgres.db)).rows[0]!.count)));
    expect(counts).toEqual([0, 0, 0, 0, 0, 0, 0]);
    const audit = await postgres.db.selectFrom("audit_logs").selectAll().where("action", "=", "advanced_analysis.deleted").executeTakeFirstOrThrow();
    expect(audit).toMatchObject({ actor_user_id: identities.owner!.id, target_id: runId, metadata: { bookId, jobId, status: "cancelled" } }); expect(JSON.stringify(audit)).not.toMatch(/DELETE_(PROMPT|SCHEMA)_SENTINEL/);
  });
});
