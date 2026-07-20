import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildL1Signature, buildL2Signature } from "@novel-analysis/domain";
import { createContentCipher, createIndexRepository, createLibraryRepository } from "@novel-analysis/database";
import { createDisposablePostgres, type DisposablePostgres } from "../../../database/src/testing/postgres.js";

import {
  L2JobService,
  L2ScopeChangedError,
  L2_ADMISSION_VERSION,
  L2_FACT_SCHEMA_VERSION,
} from "./l2-job.js";
import { L1_ROUTE_SCHEMA_VERSION } from "./l1-job.js";

const cipher = createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 5) } });
const l1PromptContent = "L1 prompt";
const l2PromptContent = "L2 prompt";

describe("L2 job service", () => {
  let postgres: DisposablePostgres;
  let userId: string;
  let bookId: string;
  let groupId: string;

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    userId = (await postgres.db.insertInto("users").values({ display_name: "Member", role: "member", status: "active" }).returning("id").executeTakeFirstOrThrow()).id;
    bookId = (await createLibraryRepository(postgres.db, cipher).createBook({ title: "Book", createdBy: userId })).id;
    const library = createLibraryRepository(postgres.db, cipher);
    const indexes = createIndexRepository(postgres.db, cipher);
    const l1Prompt = await indexes.createPromptVersion({ target: "l1-index", version: "l1-v1", content: l1PromptContent, contentHash: createHash("sha256").update(l1PromptContent).digest("hex") });
    const l1Workflow = await indexes.createWorkflowVersion({ target: "l1-index", contractVersion: "l1-adapter-v1", dslHash: "l1-workflow-v1" });
    const l2Prompt = await indexes.createPromptVersion({ target: "l2-index", version: "l2-v1", content: l2PromptContent, contentHash: createHash("sha256").update(l2PromptContent).digest("hex") });
    const l2Workflow = await indexes.createWorkflowVersion({ target: "l2-index", contractVersion: "l2-adapter-v1", dslHash: "l2-workflow-v1" });
    groupId = (await indexes.createIndexGroup({ bookId, key: "people", name: "People", categoryScope: "general", promptVersionId: l2Prompt.id, configHash: "group-config-v1" })).id;

    for (let chapterIndex = 1; chapterIndex <= 4; chapterIndex += 1) {
      const chapter = await library.insertChapter({ bookId, chapterIndex, title: `Chapter ${chapterIndex}`, plaintext: `secret-${chapterIndex}`, contentHmac: `hmac-${chapterIndex}`, sourceVersion: "source-v1" });
      const l1Signature = buildL1Signature({ sourceVersion: "source-v1", chapterHmac: `hmac-${chapterIndex}`, promptHash: l1Prompt.content_hash, workflowDslHash: l1Workflow.dsl_hash, adapterContractVersion: l1Workflow.contract_version, schemaVersion: L1_ROUTE_SCHEMA_VERSION });
      await indexes.putL1Index({ chapterId: chapter.id, promptVersionId: l1Prompt.id, workflowVersionId: l1Workflow.id, inputSignature: l1Signature, status: "fresh", route: { route_schema_version: L1_ROUTE_SCHEMA_VERSION } });
      if (chapterIndex !== 2) {
        const l2Signature = buildL2Signature({ sourceVersion: "source-v1", chapterHmac: `hmac-${chapterIndex}`, promptHash: l2Prompt.content_hash, workflowDslHash: l2Workflow.dsl_hash, adapterContractVersion: l2Workflow.contract_version, schemaVersion: L2_FACT_SCHEMA_VERSION, admissionVersion: L2_ADMISSION_VERSION, indexGroupConfigHash: "group-config-v1", l1Signature });
        await indexes.putL2ChapterStatus({ groupId, chapterId: chapter.id, inputSignature: chapterIndex === 4 ? "old-signature" : l2Signature, status: chapterIndex === 3 ? "failed" : chapterIndex === 4 ? "stale" : "fresh" });
      }
    }
  });

  afterEach(async () => postgres.destroy());

  it("partitions scope, freezes execution config and creates one step per selected chapter", async () => {
    const service = new L2JobService(postgres.db);
    const all = await service.preview({ bookId, groupId, startChapter: 1, endChapter: 4, mode: "all", force: false });
    expect(all).toMatchObject({ total: 4, executable: 4, skipped: 0, scopeHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const missing = await service.preview({ bookId, groupId, startChapter: 1, endChapter: 4, mode: "missing", force: false });
    expect(missing).toMatchObject({ total: 4, executable: 1, skipped: 3 });
    expect(await service.preview({ bookId, groupId, startChapter: 1, endChapter: 4, mode: "missing", force: true })).toMatchObject({ total: 4, executable: 1, skipped: 3 });
    const retry = await service.preview({ bookId, groupId, startChapter: 1, endChapter: 4, mode: "retry_failed", force: false });
    expect(retry).toMatchObject({ executable: 1, skipped: 3 });
    const narrow = await service.preview({ bookId, groupId, startChapter: 2, endChapter: 2, mode: "missing", force: false });
    expect(narrow).toMatchObject({ total: 1, fresh: 0, missing: 1, failed: 0, stale: 0, executable: 1, skipped: 0 });
    await postgres.db.updateTable("chapters").set({ content_hmac: "outside-range-change" }).where("book_id", "=", bookId).where("chapter_index", "=", 1).execute();
    expect((await service.preview({ bookId, groupId, startChapter: 2, endChapter: 2, mode: "missing", force: false })).scopeHash).toBe(narrow.scopeHash);
    await postgres.db.updateTable("chapters").set({ content_hmac: "hmac-1" }).where("book_id", "=", bookId).where("chapter_index", "=", 1).execute();

    const job = await service.create({ bookId, groupId, startChapter: 1, endChapter: 4, mode: "missing", force: false, requestedBy: userId, requestId: "l2-missing", scopeHash: missing.scopeHash });
    const stored = await postgres.db.selectFrom("jobs").selectAll().where("id", "=", job.id).executeTakeFirstOrThrow();
    const steps = await postgres.db.selectFrom("job_steps").selectAll().where("job_id", "=", job.id).execute();
    expect(stored).toMatchObject({ type: "l2-index", concurrency_key: expect.stringContaining(`l2:${bookId}:${groupId}:`) });
    expect(stored.config_snapshot).toMatchObject({
      scopeHash: missing.scopeHash,
      prompt: { content: l2PromptContent },
      workflow: { dslHash: "l2-workflow-v1", adapterContractVersion: "l2-adapter-v1" },
      schemaVersion: L2_FACT_SCHEMA_VERSION,
      admissionVersion: L2_ADMISSION_VERSION,
      indexGroup: { id: groupId, key: "people", categoryScope: "general", configHash: "group-config-v1" },
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ position: 2, kind: "l2-index", output_ref: null });
    expect(await postgres.db.selectFrom("job_events").select("id").where("job_id", "=", job.id).execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("job_outbox").select("id").where("job_id", "=", job.id).execute()).toHaveLength(1);
    expect(JSON.stringify({ scope: stored.scope, steps })).not.toContain(l2PromptContent);
    expect(JSON.stringify({ scope: stored.scope, steps })).not.toContain("secret-");

    const replay = await service.create({ bookId, groupId, startChapter: 1, endChapter: 4, mode: "missing", force: false, requestedBy: userId, requestId: "l2-missing", scopeHash: missing.scopeHash });
    expect(replay.id).toBe(job.id);
  });

  it("rejects changed Workflow scope with zero effects", async () => {
    const service = new L2JobService(postgres.db);
    const preview = await service.preview({ bookId, groupId, startChapter: 1, endChapter: 4, mode: "missing", force: false });
    await createIndexRepository(postgres.db, cipher).createWorkflowVersion({ target: "l2-index", contractVersion: "l2-adapter-v2", dslHash: "l2-workflow-v2" });
    const changed = await service.preview({ bookId, groupId, startChapter: 1, endChapter: 4, mode: "missing", force: false });
    expect(changed.scopeHash).not.toBe(preview.scopeHash);

    await expect(service.create({ bookId, groupId, startChapter: 1, endChapter: 4, mode: "missing", force: false, requestedBy: userId, requestId: "stale-preview", scopeHash: preview.scopeHash })).rejects.toBeInstanceOf(L2ScopeChangedError);
    expect(await postgres.db.selectFrom("jobs").select("id").execute()).toEqual([]);
    expect(await postgres.db.selectFrom("job_steps").select("id").execute()).toEqual([]);
    expect(await postgres.db.selectFrom("job_events").select("id").execute()).toEqual([]);
    expect(await postgres.db.selectFrom("job_outbox").select("id").execute()).toEqual([]);
  });

  it("merges concurrent requests for the same frozen execution", async () => {
    const service = new L2JobService(postgres.db);
    const preview = await service.preview({ bookId, groupId, startChapter: 1, endChapter: 4, mode: "missing", force: false });
    const input = { bookId, groupId, startChapter: 1, endChapter: 4, mode: "missing" as const, force: false, requestedBy: userId, scopeHash: preview.scopeHash };

    const [first, second] = await Promise.all([
      service.create({ ...input, requestId: "concurrent-a" }),
      service.create({ ...input, requestId: "concurrent-b" }),
    ]);

    expect(second.id).toBe(first.id);
    expect(await postgres.db.selectFrom("jobs").select("id").where("type", "=", "l2-index").execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("job_steps").select("id").execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("job_outbox").select("id").execute()).toHaveLength(1);
  });
});
