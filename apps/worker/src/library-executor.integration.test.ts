import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createContentCipher, createLibraryRepository } from "@novel-analysis/database";
import { FakeDifyAdapter, type DifyAdapter } from "@novel-analysis/dify";
import { ImportJobService, PostgresStepLeaseService } from "@novel-analysis/jobs";
import { createDisposablePostgres, type DisposablePostgres } from "../../../packages/database/src/testing/postgres.js";

import { LibraryImportExecutor } from "./library-executor.js";
import { createWorkerStepExecutor, parseLibraryRuntimeConfig } from "./worker.js";

describe("library import executor", () => {
  let postgres: DisposablePostgres;
  let userId: string;
  let bookId: string;

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    userId = (await postgres.db.insertInto("users").values({ display_name: "member", avatar_url: null, role: "member", status: "active" }).returning("id").executeTakeFirstOrThrow()).id;
    const library = createLibraryRepository(postgres.db, createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 1) } }));
    bookId = (await library.createBook({ title: "Book", createdBy: userId })).id;
    await library.upsertSource({ bookId, provider: "dify", sourceId: "1", startChapter: 1, endChapter: 1 });
  });

  afterEach(async () => postgres.destroy());

  async function claim(autoStartL1 = false) {
    const jobs = new ImportJobService(postgres.db);
    const preview = await jobs.preview({ bookId });
    const job = await jobs.create({ bookId, requestedBy: userId, requestId: crypto.randomUUID(), scopeHash: preview.scopeHash, autoStartL1 });
    const claimed = await new PostgresStepLeaseService({ database: postgres.db, leaseDurationMs: 60_000 }).claimNext(job.id, "worker", new Date());
    if (!claimed) throw new Error("claim missing");
    return claimed;
  }

  it("validates, encrypts and completes a chapter in one transaction without plaintext effects", async () => {
    const claimed = await claim(true);
    const adapter = new FakeDifyAdapter([{ target: "chapter-import", invocationKey: claimed.stepId, output: { chapters: [{ book_id: "1", chapter_index: 1, chapter_title: "One", content: "TOP_SECRET_BODY", fetch_status: "ok" }] } }]);
    const cipher = createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 2) } });
    const executor = new LibraryImportExecutor({ database: postgres.db, adapter, cipher, hmacKey: Buffer.from("hmac-secret") });
    expect(await executor.execute(claimed)).toEqual({ disposition: "completed" });

    const chapter = await postgres.db.selectFrom("chapters").selectAll().executeTakeFirstOrThrow();
    expect(chapter.content_hmac).toBe(createHmac("sha256", "hmac-secret").update("TOP_SECRET_BODY").digest("hex"));
    expect(cipher.decrypt({ ciphertext: chapter.content_ciphertext, nonce: chapter.content_nonce, tag: chapter.content_tag, keyVersion: chapter.content_key_version })).toBe("TOP_SECRET_BODY");
    const step = await postgres.db.selectFrom("job_steps").select(["status", "output_ref"]).where("id", "=", claimed.stepId).executeTakeFirstOrThrow();
    expect(step).toEqual({ status: "completed", output_ref: { chapterId: chapter.id, chapterIndex: 1 } });
    const serialized = JSON.stringify({ step, events: await postgres.db.selectFrom("job_events").selectAll().execute() });
    expect(serialized).not.toContain("TOP_SECRET_BODY");
    expect(await postgres.db.selectFrom("jobs").select("type").where("type", "=", "l1-index").execute()).toHaveLength(1);
  });

  it("atomically fails provider errors without chapter effects and discards a late result after cancellation", async () => {
    const failedClaim = await claim();
    const failing = new FakeDifyAdapter([]);
    const cipher = createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 2) } });
    expect(await new LibraryImportExecutor({ database: postgres.db, adapter: failing, cipher, hmacKey: Buffer.from("hmac") }).execute(failedClaim)).toEqual({ disposition: "failed" });
    expect(await postgres.db.selectFrom("chapters").selectAll().execute()).toEqual([]);
    expect(await postgres.db.selectFrom("job_attempts").select(["status", "error_code", "error_message"]).where("id", "=", failedClaim.attemptId).executeTakeFirstOrThrow()).toEqual({ status: "failed", error_code: "provider_unavailable", error_message: "provider_unavailable" });
    expect(await postgres.db.selectFrom("job_steps").select("status").where("id", "=", failedClaim.stepId).executeTakeFirstOrThrow()).toEqual({ status: "failed" });
    const failedJob = await postgres.db.selectFrom("jobs").select(["status", "progress"]).where("id", "=", failedClaim.jobId).executeTakeFirstOrThrow();
    expect(failedJob.status).toBe("failed");
    expect(failedJob.progress.failed).toBe(1);
    expect(await postgres.db.selectFrom("job_events").select(["type", "payload"]).where("job_id", "=", failedClaim.jobId).where("type", "=", "failed").executeTakeFirstOrThrow()).toEqual({ type: "failed", payload: { stepId: failedClaim.stepId, position: 1, errorCode: "provider_unavailable", progress: failedJob.progress } });

    await postgres.db.deleteFrom("jobs").where("id", "=", failedClaim.jobId).execute();
    const structuralClaim = await claim();
    const malformed = { runChapterImport: async () => ({ chapters: [] }) } as unknown as DifyAdapter;
    expect(await new LibraryImportExecutor({ database: postgres.db, adapter: malformed, cipher, hmacKey: Buffer.from("hmac") }).execute(structuralClaim)).toEqual({ disposition: "failed" });
    expect((await postgres.db.selectFrom("job_attempts").select("error_code").where("id", "=", structuralClaim.attemptId).executeTakeFirstOrThrow()).error_code).toBe("provider_invalid_response");
    expect(await postgres.db.selectFrom("chapters").selectAll().execute()).toEqual([]);
    await postgres.db.deleteFrom("jobs").where("id", "=", structuralClaim.jobId).execute();
    const lateClaim = await claim();
    const adapter = new FakeDifyAdapter([{ target: "chapter-import", invocationKey: lateClaim.stepId, output: { chapters: [{ book_id: "1", chapter_index: 1, chapter_title: "One", content: "late", fetch_status: "ok" }] } }]);
    await postgres.db.updateTable("jobs").set({ status: "cancelled" }).where("id", "=", lateClaim.jobId).execute();
    expect(await new LibraryImportExecutor({ database: postgres.db, adapter, cipher, hmacKey: Buffer.from("hmac") }).execute(lateClaim)).toEqual({ disposition: "discarded-cancelled" });
    expect(await postgres.db.selectFrom("chapters").selectAll().execute()).toEqual([]);
  });

  it("updates a stale chapter in place and marks current L1 and related L2 stale without deleting history or facts", async () => {
    const cipher = createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 2) } });
    const library = createLibraryRepository(postgres.db, cipher);
    const old = await library.insertChapter({ bookId, chapterIndex: 1, title: "Old", plaintext: "old body", contentHmac: "old-hmac", sourceVersion: "old-source" });
    const prompt = await postgres.db.insertInto("prompt_versions").values({ target: "l1-index", version: "v1", content_hash: "prompt" }).returning("id").executeTakeFirstOrThrow();
    const workflow = await postgres.db.insertInto("workflow_versions").values({ target: "l1-index", contract_version: "v1", dsl_hash: "dsl" }).returning("id").executeTakeFirstOrThrow();
    const historical = await postgres.db.insertInto("l1_indexes").values({ chapter_id: old.id, prompt_version_id: prompt.id, workflow_version_id: workflow.id, input_signature: "history", status: "stale", is_current: false, route: {} }).returning("id").executeTakeFirstOrThrow();
    const current = await postgres.db.insertInto("l1_indexes").values({ chapter_id: old.id, prompt_version_id: prompt.id, workflow_version_id: workflow.id, input_signature: "current", status: "fresh", is_current: true, route: {} }).returning("id").executeTakeFirstOrThrow();
    const l2Prompt = await postgres.db.insertInto("prompt_versions").values({ target: "l2-index", version: "v1", content_hash: "l2-prompt" }).returning("id").executeTakeFirstOrThrow();
    const group = await postgres.db.insertInto("index_groups").values({ book_id: bookId, key: "people", name: "People", prompt_version_id: l2Prompt.id, config_hash: "config" }).returning("id").executeTakeFirstOrThrow();
    await postgres.db.insertInto("l2_chapter_statuses").values({ group_id: group.id, chapter_id: old.id, book_id: bookId, input_signature: "l2", status: "fresh", failure_code: null }).execute();
    await postgres.db.insertInto("l2_subjects").values({ group_id: group.id, subject_key: "hero", display_name: "Hero", aliases: {} }).execute();
    const encryptedFact = cipher.encrypt("fact body");
    const fact = await postgres.db.insertInto("l2_facts").values({ group_id: group.id, chapter_id: old.id, book_id: bookId, subject_key: "hero", fact_type: "event", fact_ciphertext: encryptedFact.ciphertext, fact_nonce: encryptedFact.nonce, fact_tag: encryptedFact.tag, fact_key_version: encryptedFact.keyVersion, metadata: {} }).returning("id").executeTakeFirstOrThrow();
    const failedClaim = await claim();
    expect(await new LibraryImportExecutor({ database: postgres.db, adapter: new FakeDifyAdapter([]), cipher, hmacKey: Buffer.from("hmac") }).execute(failedClaim)).toEqual({ disposition: "failed" });
    expect(await postgres.db.selectFrom("chapters").select(["id", "title", "source_version"]).where("id", "=", old.id).executeTakeFirstOrThrow()).toEqual({ id: old.id, title: "Old", source_version: "old-source" });
    expect((await postgres.db.selectFrom("l1_indexes").select("status").where("id", "=", current.id).executeTakeFirstOrThrow()).status).toBe("fresh");
    expect((await postgres.db.selectFrom("l2_chapter_statuses").select("status").where("chapter_id", "=", old.id).executeTakeFirstOrThrow()).status).toBe("fresh");
    expect((await postgres.db.selectFrom("l2_facts").select("id").where("id", "=", fact.id).executeTakeFirstOrThrow()).id).toBe(fact.id);
    await postgres.db.deleteFrom("jobs").where("id", "=", failedClaim.jobId).execute();
    const claimed = await claim();
    const adapter = new FakeDifyAdapter([{ target: "chapter-import", invocationKey: claimed.stepId, output: { chapters: [{ book_id: "1", chapter_index: 1, chapter_title: "New", content: "new body", fetch_status: "ok" }] } }]);
    expect(await new LibraryImportExecutor({ database: postgres.db, adapter, cipher, hmacKey: Buffer.from("hmac") }).execute(claimed)).toEqual({ disposition: "completed" });
    const updated = await postgres.db.selectFrom("chapters").selectAll().where("book_id", "=", bookId).where("chapter_index", "=", 1).executeTakeFirstOrThrow();
    expect(updated.id).toBe(old.id);
    expect(updated.title).toBe("New");
    expect(cipher.decrypt({ ciphertext: updated.content_ciphertext, nonce: updated.content_nonce, tag: updated.content_tag, keyVersion: updated.content_key_version })).toBe("new body");
    expect(await postgres.db.selectFrom("l1_indexes").select(["id", "status", "is_current"]).where("chapter_id", "=", old.id).orderBy("created_at").execute()).toEqual(expect.arrayContaining([
      { id: historical.id, status: "stale", is_current: false },
      { id: current.id, status: "stale", is_current: true },
    ]));
    expect((await postgres.db.selectFrom("l2_chapter_statuses").select("status").where("chapter_id", "=", old.id).executeTakeFirstOrThrow()).status).toBe("stale");
    expect((await postgres.db.selectFrom("l2_facts").select("id").where("id", "=", fact.id).executeTakeFirstOrThrow()).id).toBe(fact.id);
  });

  it("keeps example execution available without Task 3 config and fails chapter claims closed", async () => {
    const executor = createWorkerStepExecutor({ database: postgres.db });
    expect(await executor.execute({ jobId: "job", stepId: "step", attemptId: "attempt", attemptNo: 1, position: 0, kind: "example", workerId: "worker", leaseExpiresAt: new Date() })).toMatchObject({ kind: "example" });
    const claimed = await claim();
    expect(await executor.execute(claimed)).toEqual({ disposition: "failed" });
    expect((await postgres.db.selectFrom("jobs").select("status").where("id", "=", claimed.jobId).executeTakeFirstOrThrow()).status).toBe("failed");
    expect((await postgres.db.selectFrom("job_attempts").select("error_code").where("id", "=", claimed.attemptId).executeTakeFirstOrThrow()).error_code).toBe("configuration_error");
  });

  it("parses runtime config as absent, complete, or redacted invalid without exposing values", () => {
    expect(parseLibraryRuntimeConfig({})).toBeUndefined();
    const valid = { DIFY_BASE_URL: "https://dify.test", DIFY_CHAPTER_IMPORT_KEY: "secret-key", CONTENT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), CONTENT_ENCRYPTION_KEY_VERSION: "v1", CONTENT_HMAC_KEY: Buffer.from("hmac-key").toString("base64") };
    expect(parseLibraryRuntimeConfig(valid)).toMatchObject({ baseUrl: "https://dify.test", chapterImportKey: "secret-key", contentKeyVersion: "v1" });
    for (const field of Object.keys(valid)) {
      const partial = { ...valid };
      delete partial[field as keyof typeof partial];
      expect(() => parseLibraryRuntimeConfig(partial)).toThrow(field);
    }
    const invalid = [
      { ...valid, DIFY_BASE_URL: "not-a-url" },
      { ...valid, DIFY_CHAPTER_IMPORT_KEY: " " },
      { ...valid, CONTENT_ENCRYPTION_KEY: Buffer.alloc(31).toString("base64") },
      { ...valid, CONTENT_HMAC_KEY: "" },
    ];
    for (const environment of invalid) {
      try { parseLibraryRuntimeConfig(environment); throw new Error("expected invalid config"); }
      catch (error) {
        const message = (error as Error).message;
        expect(message).not.toContain("secret-key");
        expect(message).not.toContain(valid.CONTENT_ENCRYPTION_KEY);
      }
    }
  });

  it("serializes two workers on the book row so the second commit skips without overwriting", async () => {
    const firstClaim = await claim();
    const firstJob = await postgres.db.selectFrom("jobs").select(["scope", "config_snapshot"]).where("id", "=", firstClaim.jobId).executeTakeFirstOrThrow();
    const secondJob = await postgres.db.insertInto("jobs").values({ type: "import", status: "queued", requested_by: userId, request_id: "parallel-second", scope: firstJob.scope, config_snapshot: firstJob.config_snapshot, concurrency_key: null, progress: { total: 1, completed: 0, failed: 0, skipped: 0, current: "" } }).returning("id").executeTakeFirstOrThrow();
    const secondStep = await postgres.db.insertInto("job_steps").values({ job_id: secondJob.id, position: 1, kind: "chapter-import", status: "queued", input_signature: `${firstJob.config_snapshot.sourceVersion}:1`, idempotency_key: `${secondJob.id}:1`, output_ref: null, lease_owner: null, lease_expires_at: null }).returning("id").executeTakeFirstOrThrow();
    const secondClaim = await new PostgresStepLeaseService({ database: postgres.db, leaseDurationMs: 60_000 }).claimNext(secondJob.id, "worker-2", new Date());
    if (!secondClaim) throw new Error("second claim missing");
    const output = { chapters: [{ book_id: "1", chapter_index: 1, chapter_title: "One", content: "single effect", fetch_status: "ok" }] };
    const adapter = new FakeDifyAdapter([
      { target: "chapter-import", invocationKey: firstClaim.stepId, output, delayMs: 10 },
      { target: "chapter-import", invocationKey: secondClaim.stepId, output },
    ]);
    const executor = new LibraryImportExecutor({ database: postgres.db, adapter, cipher: createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 2) } }), hmacKey: Buffer.from("hmac") });
    expect(await Promise.all([executor.execute(firstClaim), executor.execute(secondClaim)])).toEqual([{ disposition: "completed" }, { disposition: "completed" }]);
    expect(await postgres.db.selectFrom("chapters").select("id").where("book_id", "=", bookId).execute()).toHaveLength(1);
    const progresses = await postgres.db.selectFrom("jobs").select("progress").where("id", "in", [firstClaim.jobId, secondJob.id]).execute();
    expect(progresses.reduce((sum, row) => sum + Number(row.progress.completed), 0)).toBe(1);
    expect(progresses.reduce((sum, row) => sum + Number(row.progress.skipped), 0)).toBe(1);
    expect((await postgres.db.selectFrom("job_steps").select("status").where("id", "=", secondStep.id).executeTakeFirstOrThrow()).status).toBe("completed");
  });

  it("skips a source-signature match without calling the provider and does not duplicate handoff on replay", async () => {
    const jobs = new ImportJobService(postgres.db);
    const initial = await jobs.preview({ bookId });
    const seedJob = await jobs.create({ bookId, requestedBy: userId, requestId: "seed", scopeHash: initial.scopeHash, autoStartL1: false });
    const config = (await postgres.db.selectFrom("jobs").select("config_snapshot").where("id", "=", seedJob.id).executeTakeFirstOrThrow()).config_snapshot;
    await postgres.db.deleteFrom("jobs").where("id", "=", seedJob.id).execute();
    const library = createLibraryRepository(postgres.db, createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 1) } }));
    await library.insertChapter({ bookId, chapterIndex: 1, title: "Existing", plaintext: "existing", contentHmac: "h", sourceVersion: String(config.sourceVersion) });

    // Force a recovery-shaped queued step to prove executor-side signature defense
    const job = await postgres.db.insertInto("jobs").values({ type: "import", status: "queued", requested_by: userId, request_id: "recovery", scope: { bookId, startChapter: 1, endChapter: 1 }, config_snapshot: config, concurrency_key: `import:${bookId}`, progress: { total: 1, completed: 0, failed: 0, skipped: 0, current: "" } }).returning("id").executeTakeFirstOrThrow();
    await postgres.db.insertInto("job_steps").values({ job_id: job.id, position: 1, kind: "chapter-import", status: "queued", input_signature: `${config.sourceVersion}:1`, idempotency_key: `${job.id}:1`, output_ref: null, lease_owner: null, lease_expires_at: null }).execute();
    const claimed = await new PostgresStepLeaseService({ database: postgres.db, leaseDurationMs: 60_000 }).claimNext(job.id, "worker", new Date());
    if (!claimed) throw new Error("claim missing");
    const adapter = new FakeDifyAdapter([]);
    const executor = new LibraryImportExecutor({ database: postgres.db, adapter, cipher: createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 2) } }), hmacKey: Buffer.from("hmac") });
    expect(await executor.execute(claimed)).toEqual({ disposition: "completed" });
    expect(adapter.calls).toEqual([]);
    expect((await postgres.db.selectFrom("jobs").select("progress").where("id", "=", job.id).executeTakeFirstOrThrow()).progress.skipped).toBe(1);
    expect(await executor.execute(claimed)).toEqual({ disposition: "already-completed" });
  });
});
