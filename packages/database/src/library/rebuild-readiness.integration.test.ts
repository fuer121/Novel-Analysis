import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildL1Signature, buildL2Signature } from "@novel-analysis/domain";

import { createContentCipher } from "./content-encryption.js";
import { createIndexRepository } from "./index-repository.js";
import { createLibraryRepository } from "./library-repository.js";
import { getBookAnalysisReadiness } from "./rebuild-readiness.js";
import { createDisposablePostgres, type DisposablePostgres } from "../testing/postgres.js";

describe("book analysis readiness", () => {
  const L1_SCHEMA = "l1-route-v1";
  const L2_SCHEMA = "l2-facts-v1";
  const L2_ADMISSION = "l2-admission-v1";
  let postgres: DisposablePostgres;
  const cipher = createContentCipher({ activeKeyVersion: "v1", keys: { v1: Buffer.alloc(32, 7) } });
  let userId: string;

  beforeAll(async () => {
    postgres = await createDisposablePostgres();
    userId = (await postgres.db.insertInto("users").values({ display_name: "Owner", avatar_url: null, role: "member", status: "active" }).returning("id").executeTakeFirstOrThrow()).id;
  });
  afterAll(async () => postgres?.destroy());

  async function fixture(chapterTotal: number) {
    const library = createLibraryRepository(postgres.db, cipher);
    const book = await library.createBook({ title: crypto.randomUUID(), createdBy: userId });
    const chapters = [];
    for (let chapterIndex = 1; chapterIndex <= chapterTotal; chapterIndex += 1) {
      chapters.push(await library.insertChapter({ bookId: book.id, chapterIndex, title: `C${chapterIndex}`, plaintext: "text", contentHmac: `h${chapterIndex}`, sourceVersion: "v1" }));
    }
    return { bookId: book.id, chapters };
  }

  async function indexSetup(bookId: string) {
    const indexes = createIndexRepository(postgres.db, cipher);
    const l1Prompt = await indexes.createPromptVersion({ target: "l1-index", version: crypto.randomUUID(), content: "l1", contentHash: createHash("sha256").update("l1").digest("hex") });
    const l2Prompt = await indexes.createPromptVersion({ target: "l2-index", version: crypto.randomUUID(), content: "l2", contentHash: createHash("sha256").update("l2").digest("hex") });
    const workflow = await indexes.createWorkflowVersion({ target: "l1-index", contractVersion: crypto.randomUUID(), dslHash: crypto.randomUUID() });
    const l2Workflow = await indexes.createWorkflowVersion({ target: "l2-index", contractVersion: crypto.randomUUID(), dslHash: crypto.randomUUID() });
    const group = await indexes.createIndexGroup({ bookId, key: "base", name: "基础事实", categoryScope: "general", promptVersionId: l2Prompt.id, configHash: "base" });
    return { indexes, l1Prompt, l2Prompt, workflow, l2Workflow, group };
  }

  async function job(bookId: string, type: "l1-index" | "l2-index", status: "running" | "failed" | "completed" | "cancelled", options: { id?: string; at?: Date } = {}) {
    return postgres.db.insertInto("jobs").values({
      id: options.id, type, status, requested_by: userId, request_id: crypto.randomUUID(), scope: { bookId },
      config_snapshot: {}, concurrency_key: null, progress: { total: 0, completed: 0, failed: 0, skipped: 0, current: "" },
      created_at: options.at, updated_at: options.at,
    }).returning("id").executeTakeFirstOrThrow();
  }

  async function completeCoverage() {
    const { bookId, chapters } = await fixture(2);
    const setup = await indexSetup(bookId);
    for (const chapter of chapters) {
      const l1Signature = buildL1Signature({ sourceVersion: chapter.source_version, chapterHmac: `h${chapter.chapter_index}`, promptHash: setup.l1Prompt.content_hash, workflowDslHash: setup.workflow.dsl_hash, adapterContractVersion: setup.workflow.contract_version, schemaVersion: L1_SCHEMA });
      const l2Signature = buildL2Signature({ sourceVersion: chapter.source_version, chapterHmac: `h${chapter.chapter_index}`, promptHash: setup.l2Prompt.content_hash, workflowDslHash: setup.l2Workflow.dsl_hash, adapterContractVersion: setup.l2Workflow.contract_version, schemaVersion: L2_SCHEMA, admissionVersion: L2_ADMISSION, indexGroupConfigHash: setup.group.config_hash, l1Signature });
      await setup.indexes.putL1Index({ chapterId: chapter.id, promptVersionId: setup.l1Prompt.id, workflowVersionId: setup.workflow.id, inputSignature: l1Signature, status: "fresh", route: {} });
      await setup.indexes.putL2ChapterStatus({ groupId: setup.group.id, chapterId: chapter.id, inputSignature: l2Signature, status: "fresh" });
    }
    return { bookId, chapters, ...setup };
  }

  test("returns waiting for a book without chapters or indexes", async () => {
    const { bookId } = await fixture(0);
    expect(await getBookAnalysisReadiness(postgres.db, bookId)).toEqual({
      state: "waiting", chapterTotal: 0, l1Fresh: 0, l2Fresh: 0, progressPercent: 0,
      analysisAvailable: false, blockingCode: "l1_incomplete",
    });
  });

  test("returns building_l1 for an active L1 job", async () => {
    const { bookId } = await fixture(2);
    await job(bookId, "l1-index", "running");
    expect(await getBookAnalysisReadiness(postgres.db, bookId)).toMatchObject({ state: "building_l1", l1Fresh: 0, progressPercent: 0, blockingCode: "l1_incomplete" });
  });

  test("returns building_l2 after L1 completes while an L2 job is active", async () => {
    const { bookId, chapters } = await fixture(2);
    const { indexes, l1Prompt, workflow } = await indexSetup(bookId);
    for (const chapter of chapters) {
      const inputSignature = buildL1Signature({ sourceVersion: chapter.source_version, chapterHmac: `h${chapter.chapter_index}`, promptHash: l1Prompt.content_hash, workflowDslHash: workflow.dsl_hash, adapterContractVersion: workflow.contract_version, schemaVersion: L1_SCHEMA });
      await indexes.putL1Index({ chapterId: chapter.id, promptVersionId: l1Prompt.id, workflowVersionId: workflow.id, inputSignature, status: "fresh", route: {} });
    }
    await job(bookId, "l2-index", "running");
    expect(await getBookAnalysisReadiness(postgres.db, bookId)).toMatchObject({ state: "building_l2", l1Fresh: 2, l2Fresh: 0, progressPercent: 50, blockingCode: "l2_incomplete" });
  });

  test("returns failed when the current rebuild job failed", async () => {
    const { bookId } = await fixture(2);
    await job(bookId, "l1-index", "failed");
    expect(await getBookAnalysisReadiness(postgres.db, bookId)).toMatchObject({ state: "failed", analysisAvailable: false, blockingCode: "rebuild_failed" });
  });

  test("returns available only for complete current L1 and base-group L2 coverage", async () => {
    const { bookId } = await completeCoverage();
    expect(await getBookAnalysisReadiness(postgres.db, bookId)).toEqual({
      state: "available", chapterTotal: 2, l1Fresh: 2, l2Fresh: 2, progressPercent: 100,
      analysisAvailable: true, blockingCode: null,
    });
  });

  test("locks retained complete coverage while a new L1 job is active", async () => {
    const { bookId } = await completeCoverage();
    await job(bookId, "l1-index", "running");
    expect(await getBookAnalysisReadiness(postgres.db, bookId)).toMatchObject({
      state: "building_l1", progressPercent: 100, analysisAvailable: false, blockingCode: "l1_incomplete",
    });
  });

  test("locks retained complete coverage while a new L2 job is active", async () => {
    const { bookId } = await completeCoverage();
    await job(bookId, "l2-index", "running");
    expect(await getBookAnalysisReadiness(postgres.db, bookId)).toMatchObject({
      state: "building_l2", progressPercent: 100, analysisAvailable: false, blockingCode: "l2_incomplete",
    });
  });

  test("marks retained complete coverage failed when the latest rebuild job failed", async () => {
    const { bookId } = await completeCoverage();
    await job(bookId, "l1-index", "failed");
    expect(await getBookAnalysisReadiness(postgres.db, bookId)).toMatchObject({
      state: "failed", progressPercent: 100, analysisAvailable: false, blockingCode: "rebuild_failed",
    });
  });

  test("invalidates stored fresh L1 and L2 after chapter source identity changes", async () => {
    const { bookId, chapters } = await completeCoverage();
    await postgres.db.updateTable("chapters").set({ source_version: "v2", content_hmac: "changed" }).where("id", "=", chapters[0]!.id).execute();
    expect(await getBookAnalysisReadiness(postgres.db, bookId)).toMatchObject({
      l1Fresh: 1, l2Fresh: 1, progressPercent: 50, analysisAvailable: false, blockingCode: "l1_incomplete",
    });
  });

  test("invalidates stored fresh L1 after a newer prompt and enabled workflow", async () => {
    const { bookId, indexes } = await completeCoverage();
    const prompt = await indexes.createPromptVersion({ target: "l1-index", version: crypto.randomUUID(), content: "new-l1", contentHash: createHash("sha256").update("new-l1").digest("hex") });
    const workflow = await indexes.createWorkflowVersion({ target: "l1-index", contractVersion: crypto.randomUUID(), dslHash: crypto.randomUUID() });
    const future = new Date(Date.now() + 60_000);
    await postgres.db.updateTable("prompt_versions").set({ created_at: future }).where("id", "=", prompt.id).execute();
    await postgres.db.updateTable("workflow_versions").set({ created_at: future }).where("id", "=", workflow.id).execute();
    try {
      expect(await getBookAnalysisReadiness(postgres.db, bookId)).toMatchObject({
        l1Fresh: 0, l2Fresh: 2, progressPercent: 50, analysisAvailable: false, blockingCode: "l1_incomplete",
      });
    } finally {
      await postgres.db.deleteFrom("workflow_versions").where("id", "=", workflow.id).execute();
      await postgres.db.deleteFrom("prompt_versions").where("id", "=", prompt.id).execute();
    }
  });

  test("invalidates stored fresh L2 after the base group prompt changes", async () => {
    const { bookId, indexes, group } = await completeCoverage();
    const prompt = await indexes.createPromptVersion({ target: "l2-index", version: crypto.randomUUID(), content: "new-l2", contentHash: createHash("sha256").update("new-l2").digest("hex") });
    await postgres.db.updateTable("index_groups").set({ prompt_version_id: prompt.id }).where("id", "=", group.id).execute();
    expect(await getBookAnalysisReadiness(postgres.db, bookId)).toMatchObject({
      l1Fresh: 2, l2Fresh: 0, progressPercent: 50, analysisAvailable: false, blockingCode: "l2_incomplete",
    });
  });

  test("invalidates stored fresh L2 after the base group config changes", async () => {
    const { bookId, group } = await completeCoverage();
    await postgres.db.updateTable("index_groups").set({ config_hash: "changed" }).where("id", "=", group.id).execute();
    expect(await getBookAnalysisReadiness(postgres.db, bookId)).toMatchObject({
      l1Fresh: 2, l2Fresh: 0, progressPercent: 50, analysisAvailable: false, blockingCode: "l2_incomplete",
    });
  });

  test("invalidates stored fresh L1 and dependent L2 after the current L1 signature changes", async () => {
    const { bookId, chapters } = await completeCoverage();
    await postgres.db.updateTable("l1_indexes").set({ input_signature: "changed" }).where("chapter_id", "=", chapters[0]!.id).where("is_current", "=", true).execute();
    expect(await getBookAnalysisReadiness(postgres.db, bookId)).toMatchObject({
      l1Fresh: 1, l2Fresh: 1, progressPercent: 50, analysisAvailable: false, blockingCode: "l1_incomplete",
    });
  });

  test("active L1 is not hidden by a newer terminal L2 job", async () => {
    const { bookId } = await completeCoverage();
    await job(bookId, "l1-index", "running", { at: new Date("2026-01-01T00:00:00Z") });
    await job(bookId, "l2-index", "completed", { at: new Date("2026-01-02T00:00:00Z") });
    expect(await getBookAnalysisReadiness(postgres.db, bookId)).toMatchObject({ state: "building_l1", analysisAvailable: false, blockingCode: "l1_incomplete" });
  });

  test("active L2 is not hidden by a newer terminal L1 job", async () => {
    const { bookId } = await completeCoverage();
    await job(bookId, "l2-index", "running", { at: new Date("2026-01-01T00:00:00Z") });
    await job(bookId, "l1-index", "completed", { at: new Date("2026-01-02T00:00:00Z") });
    expect(await getBookAnalysisReadiness(postgres.db, bookId)).toMatchObject({ state: "building_l2", analysisAvailable: false, blockingCode: "l2_incomplete" });
  });

  test("uses id as the deterministic tie-breaker for each job type", async () => {
    const { bookId } = await completeCoverage();
    const at = new Date("2026-01-01T00:00:00Z");
    await job(bookId, "l1-index", "failed", { id: "00000000-0000-4000-8000-000000000001", at });
    await job(bookId, "l1-index", "running", { id: "00000000-0000-4000-8000-000000000002", at });
    expect(await getBookAnalysisReadiness(postgres.db, bookId)).toMatchObject({ state: "building_l1", analysisAvailable: false });
  });

  test("terminal completed and cancelled jobs do not block canonical coverage", async () => {
    const { bookId } = await completeCoverage();
    await job(bookId, "l1-index", "completed");
    await job(bookId, "l2-index", "cancelled");
    expect(await getBookAnalysisReadiness(postgres.db, bookId)).toMatchObject({ state: "available", analysisAvailable: true, blockingCode: null });
  });

  test("ignores jobs belonging to another book", async () => {
    const ready = await completeCoverage();
    const other = await fixture(1);
    await job(other.bookId, "l1-index", "running");
    expect(await getBookAnalysisReadiness(postgres.db, ready.bookId)).toMatchObject({ state: "available", analysisAvailable: true });
  });

  test("treats missing base group as incomplete L2 coverage", async () => {
    const { bookId, chapters } = await fixture(1);
    const indexes = createIndexRepository(postgres.db, cipher);
    const l1Prompt = await indexes.createPromptVersion({ target: "l1-index", version: crypto.randomUUID(), content: "l1", contentHash: createHash("sha256").update("l1").digest("hex") });
    const workflow = await indexes.createWorkflowVersion({ target: "l1-index", contractVersion: crypto.randomUUID(), dslHash: crypto.randomUUID() });
    const inputSignature = buildL1Signature({ sourceVersion: chapters[0]!.source_version, chapterHmac: "h1", promptHash: l1Prompt.content_hash, workflowDslHash: workflow.dsl_hash, adapterContractVersion: workflow.contract_version, schemaVersion: L1_SCHEMA });
    await indexes.putL1Index({ chapterId: chapters[0]!.id, promptVersionId: l1Prompt.id, workflowVersionId: workflow.id, inputSignature, status: "fresh", route: {} });
    expect(await getBookAnalysisReadiness(postgres.db, bookId)).toMatchObject({ state: "building_l2", l2Fresh: 0, progressPercent: 50, analysisAvailable: false, blockingCode: "l2_incomplete" });
  });
});
