import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildL1Signature } from "@novel-analysis/domain";
import { createContentCipher, createIndexRepository, createLibraryRepository } from "@novel-analysis/database";
import { createDisposablePostgres, type DisposablePostgres } from "../../../database/src/testing/postgres.js";

import {
  L1JobService,
  L1IdempotencyConflictError,
  L1PromptConfigurationError,
  L1ScopeChangedError,
  L1_ROUTE_SCHEMA_VERSION,
} from "./l1-job.js";

const promptContent = "Return the compact L1 route";
const promptHash = createHash("sha256").update(promptContent).digest("hex");

describe("L1 job service", () => {
  let postgres: DisposablePostgres;
  let userId: string;
  let bookId: string;
  const cipher = createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 4) } });

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    userId = (await postgres.db.insertInto("users").values({ display_name: "Member", role: "member", status: "active" }).returning("id").executeTakeFirstOrThrow()).id;
    bookId = (await createLibraryRepository(postgres.db, cipher).createBook({ title: "Book", createdBy: userId })).id;
    const library = createLibraryRepository(postgres.db, cipher);
    for (let chapterIndex = 1; chapterIndex <= 5; chapterIndex += 1) {
      await library.insertChapter({ bookId, chapterIndex, title: `Chapter ${chapterIndex}`, plaintext: `body-${chapterIndex}`, contentHmac: `hmac-${chapterIndex}`, sourceVersion: "source-v1" });
    }
  });

  afterEach(async () => postgres.destroy());

  async function configuration(input: { prompt?: string; contentHash?: string; dslHash?: string; contractVersion?: string } = {}) {
    const prompt = input.prompt ?? promptContent;
    const indexes = createIndexRepository(postgres.db, cipher);
    const promptVersion = await indexes.createPromptVersion({ target: "l1-index", version: crypto.randomUUID(), content: prompt, contentHash: input.contentHash ?? createHash("sha256").update(prompt).digest("hex") });
    const workflow = await indexes.createWorkflowVersion({ target: "l1-index", contractVersion: input.contractVersion ?? "adapter-v1", dslHash: input.dslHash ?? "workflow-v1" });
    return { promptVersion, workflow };
  }

  it("partitions every chapter once and applies only the Task 0 L1 signature fields", async () => {
    const { promptVersion, workflow } = await configuration();
    const chapters = await postgres.db.selectFrom("chapters").select(["id", "chapter_index", "content_hmac", "source_version"]).where("book_id", "=", bookId).orderBy("chapter_index").execute();
    const signature = (chapter: typeof chapters[number]) => buildL1Signature({ sourceVersion: chapter.source_version, chapterHmac: chapter.content_hmac, promptHash, workflowDslHash: workflow.dsl_hash, adapterContractVersion: workflow.contract_version, schemaVersion: L1_ROUTE_SCHEMA_VERSION });
    await postgres.db.insertInto("l1_indexes").values([
      { chapter_id: chapters[0]!.id, prompt_version_id: promptVersion.id, workflow_version_id: workflow.id, input_signature: signature(chapters[0]!), status: "fresh", is_current: true, route: { route_schema_version: L1_ROUTE_SCHEMA_VERSION } },
      { chapter_id: chapters[1]!.id, prompt_version_id: promptVersion.id, workflow_version_id: workflow.id, input_signature: signature(chapters[1]!), status: "failed", is_current: true, route: {} },
      { chapter_id: chapters[2]!.id, prompt_version_id: promptVersion.id, workflow_version_id: workflow.id, input_signature: signature(chapters[2]!), status: "stale", is_current: true, route: {} },
      { chapter_id: chapters[3]!.id, prompt_version_id: promptVersion.id, workflow_version_id: workflow.id, input_signature: "old-signature", status: "fresh", is_current: true, route: {} },
    ]).execute();

    const service = new L1JobService(postgres.db);
    const preview = await service.preview({ bookId });
    expect(preview).toMatchObject({ total: 5, fresh: 1, missing: 1, failed: 1, stale: 2, executable: 4 });
    expect(preview.fresh + preview.missing + preview.failed + preview.stale).toBe(preview.total);

    await postgres.db.updateTable("chapters").set({ title: "Renamed" }).where("id", "=", chapters[0]!.id).execute();
    expect((await service.preview({ bookId })).scopeHash).toBe(preview.scopeHash);
    await postgres.db.updateTable("chapters").set({ content_hmac: "changed" }).where("id", "=", chapters[0]!.id).execute();
    const changed = await service.preview({ bookId });
    expect(changed.fresh).toBe(0);
    expect(changed.stale).toBe(3);
    expect(changed.scopeHash).not.toBe(preview.scopeHash);
  });

  it("freezes config and chapter freshness inputs while keeping sensitive content out of scope, events, and output references", async () => {
    await configuration();
    const service = new L1JobService(postgres.db);
    const preview = await service.preview({ bookId });
    const job = await service.create({ bookId, requestedBy: userId, requestId: "manual", scopeHash: preview.scopeHash });
    const stored = await postgres.db.selectFrom("jobs").selectAll().where("id", "=", job.id).executeTakeFirstOrThrow();
    const steps = await postgres.db.selectFrom("job_steps").selectAll().where("job_id", "=", job.id).orderBy("position").execute();
    const events = await postgres.db.selectFrom("job_events").selectAll().where("job_id", "=", job.id).execute();
    const outbox = await postgres.db.selectFrom("job_outbox").selectAll().where("job_id", "=", job.id).execute();

    expect(stored.config_snapshot).toMatchObject({
      prompt: { content: promptContent, contentHash: promptHash },
      workflow: { dslHash: "workflow-v1", adapterContractVersion: "adapter-v1" },
      schemaVersion: L1_ROUTE_SCHEMA_VERSION,
    });
    expect((stored.config_snapshot.chapters as unknown[])).toHaveLength(5);
    expect(steps).toHaveLength(5);
    expect(steps.every((step) => step.kind === "l1-index" && step.output_ref === null)).toBe(true);
    expect(outbox).toHaveLength(1);
    const protectedProjection = JSON.stringify({ scope: stored.scope, events, outbox, outputs: steps.map((step) => step.output_ref) });
    expect(protectedProjection).not.toContain(promptContent);
    expect(protectedProjection).not.toContain("body-");
    expect(protectedProjection).not.toContain("route_schema_version");
    await postgres.db.updateTable("chapters").set({ content_hmac: "new-scope" }).where("book_id", "=", bookId).where("chapter_index", "=", 1).execute();
    const changed = await service.preview({ bookId });
    await expect(service.create({ bookId, requestedBy: userId, requestId: "manual", scopeHash: changed.scopeHash })).rejects.toBeInstanceOf(L1IdempotencyConflictError);
  });

  it("returns the original job when an exact replay arrives after coverage becomes fresh", async () => {
    const { promptVersion, workflow } = await configuration();
    const service = new L1JobService(postgres.db);
    const originalPreview = await service.preview({ bookId });
    const original = await service.create({ bookId, requestedBy: userId, requestId: "completed-replay", scopeHash: originalPreview.scopeHash });
    const stored = await postgres.db.selectFrom("jobs").select("config_snapshot").where("id", "=", original.id).executeTakeFirstOrThrow();
    const chapters = stored.config_snapshot.chapters as Array<{ chapterId: string; inputSignature: string }>;
    const indexes = createIndexRepository(postgres.db, cipher);
    for (const chapter of chapters) {
      await indexes.putL1Index({ chapterId: chapter.chapterId, promptVersionId: promptVersion.id, workflowVersionId: workflow.id, inputSignature: chapter.inputSignature, status: "fresh", route: { route_schema_version: L1_ROUTE_SCHEMA_VERSION } });
    }
    await postgres.db.updateTable("jobs").set({ status: "completed", concurrency_key: null, progress: { total: chapters.length, completed: chapters.length, failed: 0, skipped: 0, current: "" } }).where("id", "=", original.id).execute();
    expect(await service.preview({ bookId })).toMatchObject({ fresh: 5, executable: 0 });

    const replay = await service.create({ bookId, requestedBy: userId, requestId: "completed-replay", scopeHash: originalPreview.scopeHash });
    expect(replay.id).toBe(original.id);
    expect(await postgres.db.selectFrom("jobs").select("id").where("type", "=", "l1-index").execute()).toHaveLength(1);
  });

  it("recomputes under the book lock and rejects changed scope with zero effects", async () => {
    await configuration();
    const service = new L1JobService(postgres.db);
    const preview = await service.preview({ bookId });
    await postgres.db.updateTable("chapters").set({ content_hmac: "scope-changed" }).where("book_id", "=", bookId).where("chapter_index", "=", 1).execute();
    await expect(service.create({ bookId, requestedBy: userId, requestId: "changed", scopeHash: preview.scopeHash })).rejects.toBeInstanceOf(L1ScopeChangedError);
    expect(await postgres.db.selectFrom("jobs").select("id").execute()).toEqual([]);
    expect(await postgres.db.selectFrom("job_steps").select("id").execute()).toEqual([]);
    expect(await postgres.db.selectFrom("job_events").select("id").execute()).toEqual([]);
    expect(await postgres.db.selectFrom("job_outbox").select("id").execute()).toEqual([]);
  });

  it("fails closed for legacy empty or mismatched Prompt content", async () => {
    const blank = "   ";
    await postgres.db.insertInto("prompt_versions").values({ target: "l1-index", version: "legacy-empty", content: blank, content_hash: createHash("sha256").update(blank).digest("hex") }).execute();
    await createIndexRepository(postgres.db, cipher).createWorkflowVersion({ target: "l1-index", contractVersion: "adapter-v1", dslHash: "workflow-v1" });
    await expect(new L1JobService(postgres.db).preview({ bookId })).rejects.toBeInstanceOf(L1PromptConfigurationError);
    expect(await postgres.db.selectFrom("jobs").select("id").execute()).toEqual([]);
  });
});
