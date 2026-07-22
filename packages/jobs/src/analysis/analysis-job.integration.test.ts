import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "kysely";

import { AdvancedAnalysisExecutionSnapshotSchema } from "@novel-analysis/contracts";
import { createAnalysisRepository, createContentCipher, createIndexRepository, createLibraryRepository } from "@novel-analysis/database";
import { createDisposablePostgres, type DisposablePostgres } from "../../../database/src/testing/postgres.js";

import { AnalysisIdempotencyConflictError, AnalysisInvalidStateError, AnalysisJobService, AnalysisScopeChangedError } from "./analysis-job.js";

const cipher = createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 17) } });
const executionConfig = { model: "test-model", reasoningEffort: "high", executorVersion: "analysis-test-v1" };

describe("Analysis job service", () => {
  let postgres: DisposablePostgres;
  let ownerId: string;
  let bookId: string;
  let groupId: string;
  let templateId: string;
  let chapterIds: string[];

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    ownerId = (await postgres.db.insertInto("users").values({ display_name: "Owner", role: "member", status: "active" }).returning("id").executeTakeFirstOrThrow()).id;
    const library = createLibraryRepository(postgres.db, cipher);
    const indexes = createIndexRepository(postgres.db, cipher);
    bookId = (await library.createBook({ title: "Book", createdBy: ownerId })).id;
    const prompt = await indexes.createPromptVersion({ target: "l2-index", version: "l2-v1", content: "index", contentHash: createHash("sha256").update("index").digest("hex") });
    groupId = (await indexes.createIndexGroup({ bookId, key: "people", name: "People", categoryScope: "general", promptVersionId: prompt.id, configHash: "group-v1" })).id;
    await indexes.createWorkflowVersion({ target: "analysis-summary", contractVersion: "summary-v1", dslHash: "summary-dsl-v1" });
    chapterIds = [];
    for (let chapterIndex = 1; chapterIndex <= 3; chapterIndex += 1) chapterIds.push((await library.insertChapter({ bookId, chapterIndex, title: `Chapter ${chapterIndex}`, plaintext: `SENTINEL_CHAPTER_${chapterIndex}`, contentHmac: `chapter-hmac-${chapterIndex}`, sourceVersion: "source-v1" })).id);
    templateId = (await createAnalysisRepository(postgres.db, cipher).createTemplate({ bookId, createdBy: ownerId, name: "Private", prompt: "SENTINEL_PROMPT", outputSchema: { secret: "SENTINEL_SCHEMA" }, contentHash: createHash("sha256").update("template").digest("hex"), indexGroupId: groupId })).id;
  });

  afterEach(async () => postgres.destroy());

  const input = () => ({ bookId, templateId, actor: { id: ownerId, role: "member" as const }, mode: "balanced" as const, startChapter: 1, endChapter: 3 });

  it("fails closed without a strict execution config and binds config into scope", async () => {
    expect(() => new AnalysisJobService(postgres.db, cipher)).toThrow();
    expect(() => new AnalysisJobService(postgres.db, cipher, { ...executionConfig, model: "" })).toThrow();
    const first = await new AnalysisJobService(postgres.db, cipher, executionConfig).preview(input());
    const second = await new AnalysisJobService(postgres.db, cipher, { ...executionConfig, model: "other-model" }).preview(input());
    expect(second.scopeHash).not.toBe(first.scopeHash);
  });

  it("invalidates preview scope for chapter, L1, L2 and workflow version changes", async () => {
    const service = new AnalysisJobService(postgres.db, cipher, executionConfig); const hashes = [(await service.preview(input())).scopeHash];
    await postgres.db.updateTable("chapters").set({ content_hmac: "chapter-hmac-changed", source_version: "source-v2" }).where("id", "=", chapterIds[0]!).execute(); hashes.push((await service.preview(input())).scopeHash);
    const indexes = createIndexRepository(postgres.db, cipher);
    const prompt = await indexes.createPromptVersion({ target: "l1-index", version: "l1-change", content: "l1-change", contentHash: createHash("sha256").update("l1-change").digest("hex") });
    const workflow = await indexes.createWorkflowVersion({ target: "l1-index", contractVersion: "l1-change", dslHash: "l1-change" });
    await indexes.putL1Index({ chapterId: chapterIds[0]!, promptVersionId: prompt.id, workflowVersionId: workflow.id, inputSignature: "l1-changed", status: "fresh", route: { route_schema_version: "l1-route-v1", route_entities: [], route_keywords: [], signals: [], category_scores: {} } }); hashes.push((await service.preview(input())).scopeHash);
    await indexes.putL2ChapterStatus({ groupId, chapterId: chapterIds[0]!, inputSignature: "l2-changed", status: "fresh" }); hashes.push((await service.preview(input())).scopeHash);
    await indexes.createWorkflowVersion({ target: "analysis-summary", contractVersion: "summary-v2", dslHash: "summary-dsl-v2" }); hashes.push((await service.preview(input())).scopeHash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("previews authoritative scope without creating persistent rows", async () => {
    const preview = await new AnalysisJobService(postgres.db, cipher, executionConfig).preview(input());
    expect(preview).toMatchObject({ bookId, mode: "balanced", chapterCount: 3, reviewChapterCount: 3, readsL1: true, readsL2: true, readsOriginalChapters: true, scopeHash: expect.stringMatching(/^[a-f0-9]{64}$/), executionVersions: { workflow: { target: "analysis-summary", contractVersion: "summary-v1", dslHash: "summary-dsl-v1" }, ...executionConfig, l1SchemaVersion: "l1-route-v1", l2SchemaVersion: "l2-facts-v1", l2AdmissionVersion: "l2-admission-v1" }, sourceSummary: { indexGroupId: groupId, indexGroupConfigHash: "group-v1", chapterSourceVersions: ["source-v1"], l1: { selectedCount: 3, freshCount: 0 }, l2: { selectedCount: 3, freshCount: 0 }, reviewedChapterBoundary: { startChapter: 1, endChapter: 3, maximumChapterCount: 3 } } });
    expect(await postgres.db.selectFrom("analysis_runs").select("id").execute()).toEqual([]);
    expect(await postgres.db.selectFrom("jobs").select("id").execute()).toEqual([]);
  });

  it("atomically creates exactly one encrypted run graph and safe ordinary JSON", async () => {
    const service = new AnalysisJobService(postgres.db, cipher, executionConfig);
    const preview = await service.preview(input());
    const created = await service.create({ ...input(), templateVersionId: preview.templateVersionId, scopeHash: preview.scopeHash, requestId: "request-1" });
    expect(created.run).toMatchObject({ id: expect.any(String), jobId: created.job.id, totalParts: 3, status: "queued" });
    expect(await postgres.db.selectFrom("analysis_runs").select("id").execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("analysis_parts").select("id").execute()).toHaveLength(3);
    expect(await postgres.db.selectFrom("jobs").select("id").execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("job_steps").select(["kind", "output_ref"]).execute()).toEqual([{ kind: "advanced-analysis", output_ref: { runId: created.run.id } }]);
    expect(await postgres.db.selectFrom("job_events").select("id").execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("job_outbox").select(["id", "topic"]).execute()).toEqual([{ id: expect.any(String), topic: "jobs.wake" }]);
    expect(await postgres.db.selectFrom("audit_logs").select("id").execute()).toHaveLength(1);
    const snapshot = await createAnalysisRepository(postgres.db, cipher).getRunExecutionSnapshot({ runId: created.run.id, actor: input().actor, schema: AdvancedAnalysisExecutionSnapshotSchema });
    expect(snapshot).toMatchObject({ bookId, scopeHash: preview.scopeHash, template: { id: templateId, versionId: preview.templateVersionId }, mode: "balanced", range: { startChapter: 1, endChapter: 3 }, indexGroup: { id: groupId, configHash: "group-v1" }, executionVersions: preview.executionVersions, sourcePolicy: preview.sourceSummary, chapters: [
      { id: expect.any(String), position: 1, contentHmac: "chapter-hmac-1", sourceVersion: "source-v1", l1: null, l2: null },
      { id: expect.any(String), position: 2, contentHmac: "chapter-hmac-2", sourceVersion: "source-v1", l1: null, l2: null },
      { id: expect.any(String), position: 3, contentHmac: "chapter-hmac-3", sourceVersion: "source-v1", l1: null, l2: null },
    ] });
    expect((await postgres.db.selectFrom("jobs").select("config_snapshot").where("id", "=", created.job.id).executeTakeFirstOrThrow()).config_snapshot).toEqual({ operation: "create-analysis", requestFingerprint: expect.any(String), scopeHash: preview.scopeHash, snapshotStored: true });
    const ordinary = JSON.stringify({ jobs: await postgres.db.selectFrom("jobs").selectAll().execute(), events: await postgres.db.selectFrom("job_events").selectAll().execute(), outbox: await postgres.db.selectFrom("job_outbox").selectAll().execute(), audit: await postgres.db.selectFrom("audit_logs").selectAll().execute() });
    expect(ordinary).not.toMatch(/SENTINEL_(PROMPT|SCHEMA|CHAPTER)/);
    const persisted = JSON.stringify({ templates: await postgres.db.selectFrom("analysis_templates").selectAll().execute(), versions: await postgres.db.selectFrom("analysis_template_versions").selectAll().execute(), runs: await postgres.db.selectFrom("analysis_runs").selectAll().execute(), parts: await postgres.db.selectFrom("analysis_parts").selectAll().execute(), chapters: await postgres.db.selectFrom("chapters").selectAll().execute() });
    expect(persisted).not.toMatch(/SENTINEL_(PROMPT|SCHEMA|CHAPTER)/);
  });

  it("serializes concurrent identical requests and rejects conflicting replay", async () => {
    const service = new AnalysisJobService(postgres.db, cipher, executionConfig);
    const preview = await service.preview(input());
    const createInput = { ...input(), templateVersionId: preview.templateVersionId, scopeHash: preview.scopeHash, requestId: "same" };
    const [first, second] = await Promise.all([service.create(createInput), service.create(createInput)]);
    expect(second.run.id).toBe(first.run.id);
    await expect(service.create({ ...createInput, mode: "precision" })).rejects.toBeInstanceOf(AnalysisIdempotencyConflictError);
    expect(await postgres.db.selectFrom("analysis_runs").select("id").execute()).toHaveLength(1);
    await expect(Promise.all([service.create({ ...createInput, mode: "precision" }), service.create(createInput)])).rejects.toBeInstanceOf(AnalysisIdempotencyConflictError);
    const counts = await Promise.all(["analysis_runs", "analysis_parts", "jobs", "job_steps", "job_events", "job_outbox", "audit_logs"].map(async (table) => Number((await sql<{ count: string }>`select count(*)::text as count from ${sql.table(table)}`.execute(postgres.db)).rows[0]!.count)));
    expect(counts).toEqual([1, 3, 1, 1, 1, 1, 1]);
  });

  it("rejects a stale scope hash and rolls back a forced graph failure", async () => {
    const service = new AnalysisJobService(postgres.db, cipher, executionConfig);
    const preview = await service.preview(input());
    await expect(service.create({ ...input(), templateVersionId: preview.templateVersionId, scopeHash: "0".repeat(64), requestId: "stale" })).rejects.toBeInstanceOf(AnalysisScopeChangedError);
    await sql`create function reject_analysis_outbox_insert() returns trigger language plpgsql as $$ begin raise exception 'forced outbox failure'; end $$`.execute(postgres.db);
    await sql`create trigger reject_analysis_outbox before insert on job_outbox for each row when (new.topic = 'jobs.wake') execute function reject_analysis_outbox_insert()`.execute(postgres.db);
    await expect(service.create({ ...input(), templateVersionId: preview.templateVersionId, scopeHash: preview.scopeHash, requestId: "rollback" })).rejects.toThrow();
    expect(await postgres.db.selectFrom("analysis_runs").select("id").execute()).toEqual([]);
    expect(await postgres.db.selectFrom("jobs").select("id").execute()).toEqual([]);
    expect(await postgres.db.selectFrom("audit_logs").select("id").execute()).toEqual([]);
    expect(await postgres.db.selectFrom("analysis_parts").select("id").execute()).toEqual([]);
    expect(await postgres.db.selectFrom("job_steps").select("id").execute()).toEqual([]);
    expect(await postgres.db.selectFrom("job_events").select("id").execute()).toEqual([]);
    expect(await postgres.db.selectFrom("job_outbox").select("id").execute()).toEqual([]);
  });

  it("rejects a malformed current L1 route before persisting any run graph", async () => {
    const indexes = createIndexRepository(postgres.db, cipher);
    const prompt = await indexes.createPromptVersion({ target: "l1-index", version: "malformed", content: "l1", contentHash: createHash("sha256").update("l1").digest("hex") });
    const workflow = await indexes.createWorkflowVersion({ target: "l1-index", contractVersion: "l1-contract-v1", dslHash: "l1-dsl-malformed" });
    await indexes.putL1Index({ chapterId: chapterIds[0]!, promptVersionId: prompt.id, workflowVersionId: workflow.id, inputSignature: "malformed-l1", status: "fresh", route: { unexpected: "QUALITY_REVIEW_PAYLOAD" } });
    const service = new AnalysisJobService(postgres.db, cipher, executionConfig);
    await expect(service.preview(input())).rejects.toThrow();
    const templateVersionId = (await postgres.db.selectFrom("analysis_templates").select("current_version_id").where("id", "=", templateId).executeTakeFirstOrThrow()).current_version_id!;
    await expect(service.create({ ...input(), templateVersionId, scopeHash: "0".repeat(64), requestId: "malformed-l1" })).rejects.toThrow();
    const counts = await Promise.all(["analysis_runs", "analysis_parts", "jobs", "job_steps", "job_events", "job_outbox", "audit_logs"].map(async (table) => Number((await sql<{ count: string }>`select count(*)::text as count from ${sql.table(table)}`.execute(postgres.db)).rows[0]!.count)));
    expect(counts).toEqual([0, 0, 0, 0, 0, 0, 0]);
    await postgres.db.updateTable("l1_indexes").set({ route: { route_schema_version: "l1-route-v2", route_entities: [], route_keywords: [], signals: [], category_scores: {} } }).where("chapter_id", "=", chapterIds[0]!).where("is_current", "=", true).execute();
    await expect(service.preview(input())).rejects.toThrow();
    await expect(service.create({ ...input(), templateVersionId, scopeHash: "0".repeat(64), requestId: "mismatched-l1" })).rejects.toThrow();
    const mismatchCounts = await Promise.all(["analysis_runs", "analysis_parts", "jobs", "job_steps", "job_events", "job_outbox", "audit_logs"].map(async (table) => Number((await sql<{ count: string }>`select count(*)::text as count from ${sql.table(table)}`.execute(postgres.db)).rows[0]!.count)));
    expect(mismatchCounts).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("changes new scope when mutable source state changes without drifting the existing snapshot", async () => {
    const service = new AnalysisJobService(postgres.db, cipher, executionConfig); const preview = await service.preview(input());
    const created = await service.create({ ...input(), templateVersionId: preview.templateVersionId, scopeHash: preview.scopeHash, requestId: "frozen" });
    const before = await createAnalysisRepository(postgres.db, cipher).getRunExecutionSnapshot({ runId: created.run.id, actor: input().actor, schema: AdvancedAnalysisExecutionSnapshotSchema });
    const rawBefore = await postgres.db.selectFrom("analysis_runs").select(["execution_snapshot_ciphertext", "execution_snapshot_nonce", "execution_snapshot_auth_tag", "execution_snapshot_key_version"]).where("id", "=", created.run.id).executeTakeFirstOrThrow();
    await postgres.db.updateTable("index_groups").set({ config_hash: "group-v2" }).where("id", "=", groupId).execute();
    const changed = await service.preview(input());
    expect(changed.scopeHash).not.toBe(preview.scopeHash); expect(changed.sourceSummary.indexGroupConfigHash).toBe("group-v2");
    expect(await createAnalysisRepository(postgres.db, cipher).getRunExecutionSnapshot({ runId: created.run.id, actor: input().actor, schema: AdvancedAnalysisExecutionSnapshotSchema })).toEqual(before);
    expect(await postgres.db.selectFrom("analysis_runs").select(["execution_snapshot_ciphertext", "execution_snapshot_nonce", "execution_snapshot_auth_tag", "execution_snapshot_key_version"]).where("id", "=", created.run.id).executeTakeFirstOrThrow()).toEqual(rawBefore);
  });

  it("freezes selected non-empty L1 and L2 input versions for deterministic recovery", async () => {
    const indexes = createIndexRepository(postgres.db, cipher);
    const l1Prompt = await indexes.createPromptVersion({ target: "l1-index", version: "l1-v1", content: "l1", contentHash: createHash("sha256").update("l1").digest("hex") });
    const l1Workflow = await indexes.createWorkflowVersion({ target: "l1-index", contractVersion: "l1-contract-v1", dslHash: "l1-dsl-v1" });
    const l1Route = { route_schema_version: "l1-route-v1", route_entities: [], route_keywords: ["L1_ROUTE_SENTINEL"], signals: [], category_scores: { character: 0.75 } };
    const l1 = await indexes.putL1Index({ chapterId: chapterIds[0]!, promptVersionId: l1Prompt.id, workflowVersionId: l1Workflow.id, inputSignature: "l1-input-v1", status: "fresh", route: l1Route });
    await indexes.putL2ChapterStatus({ groupId, chapterId: chapterIds[0]!, inputSignature: "l2-input-v1", status: "fresh" });
    await indexes.registerSubject({ groupId, subjectKey: "hero", displayName: "Hero", aliases: [] });
    const originalFact = await indexes.addFact({ groupId, chapterId: chapterIds[0]!, subjectKey: "hero", factType: "event", plaintext: "L2_FACT_PAYLOAD_SENTINEL", metadata: { category: "event", confidence: 0.9 } });
    const service = new AnalysisJobService(postgres.db, cipher, executionConfig); const preview = await service.preview(input());
    expect(preview.sourceSummary).toMatchObject({ l1: { selectedCount: 3, freshCount: 1 }, l2: { selectedCount: 3, freshCount: 1 } });
    const created = await service.create({ ...input(), templateVersionId: preview.templateVersionId, scopeHash: preview.scopeHash, requestId: "source-versions" });
    const snapshot = await createAnalysisRepository(postgres.db, cipher).getRunExecutionSnapshot({ runId: created.run.id, actor: input().actor, schema: AdvancedAnalysisExecutionSnapshotSchema });
    expect(snapshot!.chapters[0]).toMatchObject({ id: chapterIds[0], position: 1, l1: { id: l1.id, promptVersionId: l1Prompt.id, workflowVersionId: l1Workflow.id, inputSignature: "l1-input-v1", status: "fresh", route: l1Route }, l2: { inputSignature: "l2-input-v1", status: "fresh", facts: [{ id: originalFact.id, subjectKey: "hero", factType: "event", payload: "L2_FACT_PAYLOAD_SENTINEL", metadata: { category: "event", confidence: 0.9 } }] } });
    await postgres.db.updateTable("l1_indexes").set({ route: { ...l1Route, route_keywords: ["REPLACED_L1_ROUTE"] } }).where("id", "=", l1.id).execute();
    expect((await service.preview(input())).scopeHash).not.toBe(preview.scopeHash);
    expect((await createAnalysisRepository(postgres.db, cipher).getRunExecutionSnapshotForExecutor({ runId: created.run.id, schema: AdvancedAnalysisExecutionSnapshotSchema }))!.chapters[0]!.l1!.route).toEqual(l1Route);
    await postgres.db.transaction().execute(async (transaction) => createIndexRepository(transaction, cipher).replaceL2ChapterResult({ groupId, chapterId: chapterIds[0]!, inputSignature: "l2-input-v2", acceptedCount: 1, candidateCount: 0, rejectedCount: 0, facts: [{ subjectKey: "hero", displayName: "Hero", aliases: [], factType: "event", plaintext: "REBUILT_FACT_PAYLOAD", metadata: { category: "event" } }] }));
    expect(await postgres.db.selectFrom("l2_facts").select("id").where("id", "=", originalFact.id).execute()).toEqual([]);
    const recovered = await createAnalysisRepository(postgres.db, cipher).getRunExecutionSnapshotForExecutor({ runId: created.run.id, schema: AdvancedAnalysisExecutionSnapshotSchema });
    expect(recovered!.chapters[0]!.l2!.facts[0]).toMatchObject({ id: originalFact.id, payload: "L2_FACT_PAYLOAD_SENTINEL" });
    expect(JSON.stringify(await postgres.db.selectFrom("analysis_runs").selectAll().where("id", "=", created.run.id).executeTakeFirstOrThrow())).not.toMatch(/L1_ROUTE_SENTINEL|L2_FACT_PAYLOAD_SENTINEL/);
    const ordinary = JSON.stringify({ job: await postgres.db.selectFrom("jobs").selectAll().where("id", "=", created.job.id).execute(), events: await postgres.db.selectFrom("job_events").selectAll().where("job_id", "=", created.job.id).execute(), outbox: await postgres.db.selectFrom("job_outbox").selectAll().where("job_id", "=", created.job.id).execute(), audits: await postgres.db.selectFrom("audit_logs").selectAll().where("target_id", "=", created.run.id).execute() });
    expect(ordinary).not.toMatch(/L1_ROUTE_SENTINEL|REPLACED_L1_ROUTE|L2_FACT_PAYLOAD_SENTINEL|REBUILT_FACT_PAYLOAD/);
    expect((await service.preview(input())).scopeHash).not.toBe(preview.scopeHash);
  });

  it("hard deletes only an owner's terminal run and retains safe audit", async () => {
    const service = new AnalysisJobService(postgres.db, cipher, executionConfig);
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
    const service = new AnalysisJobService(postgres.db, cipher, executionConfig);
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
    const service = new AnalysisJobService(postgres.db, cipher, executionConfig); const preview = await service.preview(input());
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
