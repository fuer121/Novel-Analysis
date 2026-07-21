import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "kysely";

import { createAnalysisRepository, createContentCipher, createIndexRepository, createLibraryRepository } from "@novel-analysis/database";
import { createDisposablePostgres, type DisposablePostgres } from "../../../database/src/testing/postgres.js";

import { AnalysisIdempotencyConflictError, AnalysisInvalidStateError, AnalysisJobService, AnalysisScopeChangedError } from "./analysis-job.js";

const cipher = createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 17) } });

describe("Analysis job service", () => {
  let postgres: DisposablePostgres;
  let ownerId: string;
  let bookId: string;
  let groupId: string;
  let templateId: string;

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    ownerId = (await postgres.db.insertInto("users").values({ display_name: "Owner", role: "member", status: "active" }).returning("id").executeTakeFirstOrThrow()).id;
    const library = createLibraryRepository(postgres.db, cipher);
    const indexes = createIndexRepository(postgres.db, cipher);
    bookId = (await library.createBook({ title: "Book", createdBy: ownerId })).id;
    const prompt = await indexes.createPromptVersion({ target: "l2-index", version: "l2-v1", content: "index", contentHash: createHash("sha256").update("index").digest("hex") });
    groupId = (await indexes.createIndexGroup({ bookId, key: "people", name: "People", categoryScope: "general", promptVersionId: prompt.id, configHash: "group-v1" })).id;
    await indexes.createWorkflowVersion({ target: "analysis-summary", contractVersion: "summary-v1", dslHash: "summary-dsl-v1" });
    for (let chapterIndex = 1; chapterIndex <= 3; chapterIndex += 1) await library.insertChapter({ bookId, chapterIndex, title: `Chapter ${chapterIndex}`, plaintext: `SENTINEL_CHAPTER_${chapterIndex}`, contentHmac: `chapter-hmac-${chapterIndex}`, sourceVersion: "source-v1" });
    templateId = (await createAnalysisRepository(postgres.db, cipher).createTemplate({ bookId, createdBy: ownerId, name: "Private", prompt: "SENTINEL_PROMPT", outputSchema: { secret: "SENTINEL_SCHEMA" }, contentHash: createHash("sha256").update("template").digest("hex"), indexGroupId: groupId })).id;
  });

  afterEach(async () => postgres.destroy());

  const input = () => ({ bookId, templateId, actor: { id: ownerId, role: "member" as const }, mode: "balanced" as const, startChapter: 1, endChapter: 3 });

  it("previews authoritative scope without creating persistent rows", async () => {
    const preview = await new AnalysisJobService(postgres.db, cipher).preview(input());
    expect(preview).toMatchObject({ bookId, mode: "balanced", chapterCount: 3, reviewChapterCount: 3, readsL1: true, readsL2: true, readsOriginalChapters: true, scopeHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(await postgres.db.selectFrom("analysis_runs").select("id").execute()).toEqual([]);
    expect(await postgres.db.selectFrom("jobs").select("id").execute()).toEqual([]);
  });

  it("atomically creates exactly one encrypted run graph and safe ordinary JSON", async () => {
    const service = new AnalysisJobService(postgres.db, cipher);
    const preview = await service.preview(input());
    const created = await service.create({ ...input(), templateVersionId: preview.templateVersionId, scopeHash: preview.scopeHash, requestId: "request-1" });
    expect(created.run).toMatchObject({ id: expect.any(String), jobId: created.job.id, totalParts: 3, status: "queued" });
    expect(await postgres.db.selectFrom("analysis_runs").select("id").execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("analysis_parts").select("id").execute()).toHaveLength(3);
    expect(await postgres.db.selectFrom("jobs").select("id").execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("job_steps").select(["kind", "output_ref"]).execute()).toEqual([{ kind: "advanced-analysis", output_ref: { runId: created.run.id } }]);
    expect(await postgres.db.selectFrom("job_events").select("id").execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("job_outbox").select("id").execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("audit_logs").select("id").execute()).toHaveLength(1);
    const ordinary = JSON.stringify({ jobs: await postgres.db.selectFrom("jobs").selectAll().execute(), events: await postgres.db.selectFrom("job_events").selectAll().execute(), outbox: await postgres.db.selectFrom("job_outbox").selectAll().execute(), audit: await postgres.db.selectFrom("audit_logs").selectAll().execute() });
    expect(ordinary).not.toMatch(/SENTINEL_(PROMPT|SCHEMA|CHAPTER)/);
  });

  it("serializes concurrent identical requests and rejects conflicting replay", async () => {
    const service = new AnalysisJobService(postgres.db, cipher);
    const preview = await service.preview(input());
    const createInput = { ...input(), templateVersionId: preview.templateVersionId, scopeHash: preview.scopeHash, requestId: "same" };
    const [first, second] = await Promise.all([service.create(createInput), service.create(createInput)]);
    expect(second.run.id).toBe(first.run.id);
    await expect(service.create({ ...createInput, mode: "precision" })).rejects.toBeInstanceOf(AnalysisIdempotencyConflictError);
    expect(await postgres.db.selectFrom("analysis_runs").select("id").execute()).toHaveLength(1);
  });

  it("rejects a stale scope hash and rolls back a forced graph failure", async () => {
    const service = new AnalysisJobService(postgres.db, cipher);
    const preview = await service.preview(input());
    await expect(service.create({ ...input(), templateVersionId: preview.templateVersionId, scopeHash: "0".repeat(64), requestId: "stale" })).rejects.toBeInstanceOf(AnalysisScopeChangedError);
    await sql`create function reject_analysis_outbox_insert() returns trigger language plpgsql as $$ begin raise exception 'forced outbox failure'; end $$`.execute(postgres.db);
    await sql`create trigger reject_analysis_outbox before insert on job_outbox for each row when (new.topic = 'jobs.advanced-analysis.wake') execute function reject_analysis_outbox_insert()`.execute(postgres.db);
    await expect(service.create({ ...input(), templateVersionId: preview.templateVersionId, scopeHash: preview.scopeHash, requestId: "rollback" })).rejects.toThrow();
    expect(await postgres.db.selectFrom("analysis_runs").select("id").execute()).toEqual([]);
    expect(await postgres.db.selectFrom("jobs").select("id").execute()).toEqual([]);
    expect(await postgres.db.selectFrom("audit_logs").select("id").execute()).toEqual([]);
  });

  it("hard deletes only an owner's terminal run and retains safe audit", async () => {
    const service = new AnalysisJobService(postgres.db, cipher);
    const preview = await service.preview(input());
    const created = await service.create({ ...input(), templateVersionId: preview.templateVersionId, scopeHash: preview.scopeHash, requestId: "delete" });
    await expect(service.hardDelete({ runId: created.run.id, actor: { id: ownerId, role: "member" } })).rejects.toBeInstanceOf(AnalysisInvalidStateError);
    await postgres.db.updateTable("jobs").set({ status: "cancelled" }).where("id", "=", created.job.id).execute();
    await postgres.db.updateTable("analysis_runs").set({ status: "cancelled" }).where("id", "=", created.run.id).execute();
    await service.hardDelete({ runId: created.run.id, actor: { id: ownerId, role: "member" } });
    expect(await postgres.db.selectFrom("analysis_runs").select("id").execute()).toEqual([]);
    expect(await postgres.db.selectFrom("analysis_parts").select("id").execute()).toEqual([]);
    expect(await postgres.db.selectFrom("jobs").select("id").execute()).toEqual([]);
    const audit = await postgres.db.selectFrom("audit_logs").selectAll().where("action", "=", "advanced_analysis.deleted").executeTakeFirstOrThrow();
    expect(audit.metadata).toEqual({ bookId, jobId: created.job.id, status: "cancelled" });
    expect(JSON.stringify(audit)).not.toMatch(/SENTINEL_(PROMPT|SCHEMA|CHAPTER)/);
  });

  it("rolls back hard deletion when retained audit fails", async () => {
    const service = new AnalysisJobService(postgres.db, cipher);
    const preview = await service.preview(input());
    const created = await service.create({ ...input(), templateVersionId: preview.templateVersionId, scopeHash: preview.scopeHash, requestId: "audit-rollback" });
    await postgres.db.updateTable("jobs").set({ status: "failed" }).where("id", "=", created.job.id).execute();
    await postgres.db.updateTable("analysis_runs").set({ status: "failed" }).where("id", "=", created.run.id).execute();
    await sql`create function reject_analysis_delete_audit() returns trigger language plpgsql as $$ begin raise exception 'forced audit failure'; end $$`.execute(postgres.db);
    await sql`create trigger reject_analysis_delete_audit before insert on audit_logs for each row when (new.action = 'advanced_analysis.deleted') execute function reject_analysis_delete_audit()`.execute(postgres.db);
    await expect(service.hardDelete({ runId: created.run.id, actor: { id: ownerId, role: "member" } })).rejects.toThrow();
    expect(await postgres.db.selectFrom("analysis_runs").select("id").execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("jobs").select("id").execute()).toHaveLength(1);
  });

  it("rechecks terminal state after waiting for run and job locks", async () => {
    const service = new AnalysisJobService(postgres.db, cipher); const preview = await service.preview(input());
    const created = await service.create({ ...input(), templateVersionId: preview.templateVersionId, scopeHash: preview.scopeHash, requestId: "delete-race" });
    await postgres.db.updateTable("jobs").set({ status: "cancelled" }).where("id", "=", created.job.id).execute();
    await postgres.db.updateTable("analysis_runs").set({ status: "cancelled" }).where("id", "=", created.run.id).execute();
    let locked!: () => void; let release!: () => void; const acquired = new Promise<void>((resolve) => { locked = resolve; }); const gate = new Promise<void>((resolve) => { release = resolve; });
    const transition = postgres.db.transaction().execute(async (transaction) => {
      await transaction.selectFrom("analysis_runs").select("id").where("id", "=", created.run.id).forUpdate().executeTakeFirstOrThrow();
      await transaction.selectFrom("jobs").select("id").where("id", "=", created.job.id).forUpdate().executeTakeFirstOrThrow();
      await transaction.updateTable("analysis_runs").set({ status: "running" }).where("id", "=", created.run.id).execute();
      await transaction.updateTable("jobs").set({ status: "running" }).where("id", "=", created.job.id).execute(); locked(); await gate;
    });
    await acquired; const deletion = service.hardDelete({ runId: created.run.id, actor: { id: ownerId, role: "member" } }); release(); await transition;
    await expect(deletion).rejects.toBeInstanceOf(AnalysisInvalidStateError);
    expect(await postgres.db.selectFrom("analysis_runs").select("id").execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("audit_logs").select("id").where("action", "=", "advanced_analysis.deleted").execute()).toEqual([]);
  });
});
