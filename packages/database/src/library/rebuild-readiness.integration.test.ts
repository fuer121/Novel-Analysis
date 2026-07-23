import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createContentCipher } from "./content-encryption.js";
import { createIndexRepository } from "./index-repository.js";
import { createLibraryRepository } from "./library-repository.js";
import { getBookAnalysisReadiness } from "./rebuild-readiness.js";
import { createDisposablePostgres, type DisposablePostgres } from "../testing/postgres.js";

describe("book analysis readiness", () => {
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
    const group = await indexes.createIndexGroup({ bookId, key: "base", name: "基础事实", categoryScope: "general", promptVersionId: l2Prompt.id, configHash: "base" });
    return { indexes, l1Prompt, workflow, group };
  }

  async function job(bookId: string, type: "l1-index" | "l2-index", status: "running" | "failed") {
    await postgres.db.insertInto("jobs").values({
      type, status, requested_by: userId, request_id: crypto.randomUUID(), scope: { bookId },
      config_snapshot: {}, concurrency_key: null, progress: { total: 0, completed: 0, failed: 0, skipped: 0, current: "" },
    }).execute();
  }

  async function completeCoverage() {
    const { bookId, chapters } = await fixture(2);
    const { indexes, l1Prompt, workflow, group } = await indexSetup(bookId);
    for (const chapter of chapters) {
      await indexes.putL1Index({ chapterId: chapter.id, promptVersionId: l1Prompt.id, workflowVersionId: workflow.id, inputSignature: chapter.id, status: "fresh", route: {} });
      await indexes.putL2ChapterStatus({ groupId: group.id, chapterId: chapter.id, inputSignature: chapter.id, status: "fresh" });
    }
    return bookId;
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
    for (const chapter of chapters) await indexes.putL1Index({ chapterId: chapter.id, promptVersionId: l1Prompt.id, workflowVersionId: workflow.id, inputSignature: chapter.id, status: "fresh", route: {} });
    await job(bookId, "l2-index", "running");
    expect(await getBookAnalysisReadiness(postgres.db, bookId)).toMatchObject({ state: "building_l2", l1Fresh: 2, l2Fresh: 0, progressPercent: 50, blockingCode: "l2_incomplete" });
  });

  test("returns failed when the current rebuild job failed", async () => {
    const { bookId } = await fixture(2);
    await job(bookId, "l1-index", "failed");
    expect(await getBookAnalysisReadiness(postgres.db, bookId)).toMatchObject({ state: "failed", analysisAvailable: false, blockingCode: "rebuild_failed" });
  });

  test("returns available only for complete current L1 and base-group L2 coverage", async () => {
    const bookId = await completeCoverage();
    expect(await getBookAnalysisReadiness(postgres.db, bookId)).toEqual({
      state: "available", chapterTotal: 2, l1Fresh: 2, l2Fresh: 2, progressPercent: 100,
      analysisAvailable: true, blockingCode: null,
    });
  });

  test("locks retained complete coverage while a new L1 job is active", async () => {
    const bookId = await completeCoverage();
    await job(bookId, "l1-index", "running");
    expect(await getBookAnalysisReadiness(postgres.db, bookId)).toMatchObject({
      state: "building_l1", progressPercent: 100, analysisAvailable: false, blockingCode: "l1_incomplete",
    });
  });

  test("locks retained complete coverage while a new L2 job is active", async () => {
    const bookId = await completeCoverage();
    await job(bookId, "l2-index", "running");
    expect(await getBookAnalysisReadiness(postgres.db, bookId)).toMatchObject({
      state: "building_l2", progressPercent: 100, analysisAvailable: false, blockingCode: "l2_incomplete",
    });
  });

  test("marks retained complete coverage failed when the latest rebuild job failed", async () => {
    const bookId = await completeCoverage();
    await job(bookId, "l1-index", "failed");
    expect(await getBookAnalysisReadiness(postgres.db, bookId)).toMatchObject({
      state: "failed", progressPercent: 100, analysisAvailable: false, blockingCode: "rebuild_failed",
    });
  });

  test("treats missing base group as incomplete L2 coverage", async () => {
    const { bookId, chapters } = await fixture(1);
    const indexes = createIndexRepository(postgres.db, cipher);
    const l1Prompt = await indexes.createPromptVersion({ target: "l1-index", version: crypto.randomUUID(), content: "l1", contentHash: createHash("sha256").update("l1").digest("hex") });
    const workflow = await indexes.createWorkflowVersion({ target: "l1-index", contractVersion: crypto.randomUUID(), dslHash: crypto.randomUUID() });
    await indexes.putL1Index({ chapterId: chapters[0]!.id, promptVersionId: l1Prompt.id, workflowVersionId: workflow.id, inputSignature: "one", status: "fresh", route: {} });
    expect(await getBookAnalysisReadiness(postgres.db, bookId)).toMatchObject({ state: "building_l2", l2Fresh: 0, progressPercent: 50, analysisAvailable: false, blockingCode: "l2_incomplete" });
  });
});
