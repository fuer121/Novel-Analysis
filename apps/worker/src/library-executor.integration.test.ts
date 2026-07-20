import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createContentCipher, createIndexRepository, createLibraryRepository } from "@novel-analysis/database";
import { FakeDifyAdapter, type DifyAdapter } from "@novel-analysis/dify";
import { ImportJobService, L1JobService, L1_ROUTE_SCHEMA_VERSION, L2JobService, PostgresStepLeaseService } from "@novel-analysis/jobs";
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
    const indexes = createIndexRepository(postgres.db, createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 1) } }));
    const prompt = "default L1 prompt";
    await indexes.createPromptVersion({ target: "l1-index", version: "default", content: prompt, contentHash: createHash("sha256").update(prompt).digest("hex") });
    await indexes.createWorkflowVersion({ target: "l1-index", contractVersion: "adapter-v1", dslHash: "workflow-v1" });
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

  async function claimL1() {
    const cipher = createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 2) } });
    const chapter = await createLibraryRepository(postgres.db, cipher).insertChapter({ bookId, chapterIndex: 1, title: "One", plaintext: "L1_SECRET_BODY", contentHmac: "hmac-1", sourceVersion: "source-v1" });
    const prompt = "L1_SECRET_PROMPT";
    const indexes = createIndexRepository(postgres.db, cipher);
    await indexes.createPromptVersion({ target: "l1-index", version: crypto.randomUUID(), content: prompt, contentHash: createHash("sha256").update(prompt).digest("hex") });
    const jobs = new L1JobService(postgres.db);
    const preview = await jobs.preview({ bookId });
    const job = await jobs.create({ bookId, requestedBy: userId, requestId: crypto.randomUUID(), scopeHash: preview.scopeHash });
    const claimed = await new PostgresStepLeaseService({ database: postgres.db, leaseDurationMs: 60_000 }).claimNext(job.id, "worker", new Date());
    if (!claimed) throw new Error("L1 claim missing");
    return { claimed, chapter, cipher, jobs, prompt };
  }

  async function claimL2(groupKey = "magical-creatures") {
    const cipher = createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 3) } });
    const chapter = await createLibraryRepository(postgres.db, cipher).insertChapter({ bookId, chapterIndex: 1, title: "L2 One", plaintext: "L2_SECRET_BODY", contentHmac: "l2-hmac", sourceVersion: "source-v1" });
    const indexes = createIndexRepository(postgres.db, cipher);
    const l1Prompt = await postgres.db.selectFrom("prompt_versions").select("id").where("target", "=", "l1-index").executeTakeFirstOrThrow();
    const l1Workflow = await postgres.db.selectFrom("workflow_versions").select("id").where("target", "=", "l1-index").executeTakeFirstOrThrow();
    await indexes.putL1Index({ chapterId: chapter.id, promptVersionId: l1Prompt.id, workflowVersionId: l1Workflow.id, inputSignature: "l1-frozen", status: "fresh", route: { route_schema_version: L1_ROUTE_SCHEMA_VERSION, route_entities: [], route_keywords: ["小蛟"], signals: [], category_scores: {} } });
    const prompt = "L2_SECRET_PROMPT";
    const l2Prompt = await indexes.createPromptVersion({ target: "l2-index", version: crypto.randomUUID(), content: prompt, contentHash: createHash("sha256").update(prompt).digest("hex") });
    const workflowVersion = crypto.randomUUID();
    await indexes.createWorkflowVersion({ target: "l2-index", contractVersion: workflowVersion, dslHash: workflowVersion });
    const group = await indexes.createIndexGroup({ bookId, key: groupKey, name: "L2 Group", categoryScope: groupKey === "people" ? "general" : "magical_creature", promptVersionId: l2Prompt.id, configHash: "l2-config" });
    const jobs = new L2JobService(postgres.db);
    const scope = { bookId, groupId: group.id, startChapter: 1, endChapter: 1, mode: "all" as const, force: false };
    const preview = await jobs.preview(scope);
    const job = await jobs.create({ ...scope, requestedBy: userId, requestId: crypto.randomUUID(), scopeHash: preview.scopeHash });
    const claimed = await new PostgresStepLeaseService({ database: postgres.db, leaseDurationMs: 60_000 }).claimNext(job.id, "worker", new Date());
    if (!claimed) throw new Error("L2 claim missing");
    return { claimed, chapter, cipher, group, jobs, prompt };
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
    await postgres.db.deleteFrom("jobs").where("id", "=", claimed.jobId).execute();
    const l1 = await claimL1();
    expect(await executor.execute(l1.claimed)).toEqual({ disposition: "failed" });
    expect((await postgres.db.selectFrom("jobs").select("progress").where("id", "=", l1.claimed.jobId).executeTakeFirstOrThrow()).progress.current).toBe("l1-index");
  });

  it("parses runtime config as absent, complete, or redacted invalid without exposing values", () => {
    expect(parseLibraryRuntimeConfig({})).toBeUndefined();
    const valid = { DIFY_BASE_URL: "https://dify.test", DIFY_CHAPTER_IMPORT_KEY: "secret-key", DIFY_L1_WORKFLOW_API_KEY: "l1-secret-key", DIFY_L2_WORKFLOW_API_KEY: "l2-secret-key", CONTENT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), CONTENT_ENCRYPTION_KEY_VERSION: "v1", CONTENT_HMAC_KEY: Buffer.from("hmac-key").toString("base64") };
    expect(parseLibraryRuntimeConfig(valid)).toMatchObject({ baseUrl: "https://dify.test", chapterImportKey: "secret-key", l1WorkflowKey: "l1-secret-key", l2WorkflowKey: "l2-secret-key", contentKeyVersion: "v1" });
    for (const field of Object.keys(valid)) {
      const partial = { ...valid };
      delete partial[field as keyof typeof partial];
      expect(() => parseLibraryRuntimeConfig(partial)).toThrow(field);
    }
    const invalid = [
      { ...valid, DIFY_BASE_URL: "not-a-url" },
      { ...valid, DIFY_CHAPTER_IMPORT_KEY: " " },
      { ...valid, DIFY_L1_WORKFLOW_API_KEY: " " },
      { ...valid, DIFY_L2_WORKFLOW_API_KEY: " " },
      { ...valid, CONTENT_ENCRYPTION_KEY: Buffer.alloc(31).toString("base64") },
      { ...valid, CONTENT_HMAC_KEY: "" },
    ];
    for (const environment of invalid) {
      try { parseLibraryRuntimeConfig(environment); throw new Error("expected invalid config"); }
      catch (error) {
        const message = (error as Error).message;
        expect(message).not.toContain("secret-key");
        expect(message).not.toContain("l1-secret-key");
        expect(message).not.toContain("l2-secret-key");
        expect(message).not.toContain(valid.CONTENT_ENCRYPTION_KEY);
      }
    }
  });

  it("runs a frozen L2 claim, persists admitted and candidate facts atomically, and emits plaintext-safe effects", async () => {
    const { claimed, chapter, cipher, group, prompt } = await claimL2();
    const output = { chapter_index: 1, chapter_title: "L2 One", facts: [
      { category: "other" as const, entity: "白鹿", aliases: ["瑞兽"], tags: ["异兽"], related_entities: [], fact_type: "classification", fact: "L2_FACT_SECRET", evidence: ["明确称为异兽"], importance: 0.9, confidence: 0.9, scope_eligible: true, scope_basis: "explicit_nonhuman_species", transformation_eligible: false, scope_fields_complete: true, creature_type: "异兽", original_form: "白鹿", qualification_evidence: ["明确称为异兽"], subject_key: "white-deer", identity_basis: "" },
      { category: "other" as const, entity: "小蛟", aliases: [], tags: ["异兽"], related_entities: [], fact_type: "identity_clue", fact: "候选秘密", evidence: ["小蛟"], importance: 0.5, confidence: 0.6, scope_eligible: false, scope_basis: "", transformation_eligible: false, scope_fields_complete: true, creature_type: "", original_form: "", qualification_evidence: [], subject_key: "little-jiao", identity_basis: "" },
    ] };
    const adapter = new FakeDifyAdapter([{ target: "l2-index", invocationKey: claimed.stepId, output }]);
    const executor = new LibraryImportExecutor({ database: postgres.db, adapter, cipher, hmacKey: Buffer.from("hmac") });
    expect(await createWorkerStepExecutor({ database: postgres.db, libraryExecutor: executor }).execute(claimed)).toEqual({ disposition: "completed" });
    expect(adapter.calls[0]).toMatchObject({ target: "l2-index", input: { chapterContent: "L2_SECRET_BODY", indexPrompt: prompt, indexGroupKey: "magical-creatures", chapterIndex: 1 } });
    const reviews = await createIndexRepository(postgres.db, cipher).listFactReviews({ groupId: group.id, limit: 10 });
    expect(reviews.facts.map((item) => item.body)).toEqual(expect.arrayContaining(["L2_FACT_SECRET", "候选秘密"]));
    expect(await createIndexRepository(postgres.db, cipher).listVerifiedSubjects(group.id)).toEqual([{ subjectKey: "white-deer", displayName: "白鹿", aliases: ["瑞兽"] }]);
    const step = await postgres.db.selectFrom("job_steps").select(["status", "output_ref"]).where("id", "=", claimed.stepId).executeTakeFirstOrThrow();
    expect(step).toEqual({ status: "completed", output_ref: { groupId: group.id, chapterId: chapter.id, chapterIndex: 1, acceptedCount: 1, candidateCount: 1, rejectedCount: 0, factCount: 2 } });
    const effects = JSON.stringify({ step, scope: await postgres.db.selectFrom("jobs").select("scope").where("id", "=", claimed.jobId).executeTakeFirstOrThrow(), events: await postgres.db.selectFrom("job_events").selectAll().where("job_id", "=", claimed.jobId).execute() });
    for (const secret of ["L2_SECRET_BODY", "L2_FACT_SECRET", "候选秘密", prompt]) expect(effects).not.toContain(secret);
    expect(await executor.execute(claimed)).toEqual({ disposition: "already-completed" });
    expect(await postgres.db.selectFrom("l2_facts").select("id").where("group_id", "=", group.id).execute()).toHaveLength(2);
  });

  it("treats zero-admission as success, skips matching fresh status, and records a redacted failed gap", async () => {
    const first = await claimL2();
    const ordinary = { chapter_index: 1, chapter_title: "L2 One", facts: [{ category: "character" as const, entity: "年轻剑客", aliases: [], tags: ["普通人物"], related_entities: [], fact_type: "identity_clue", fact: "普通人物", evidence: ["年轻剑客"], importance: 0.5, confidence: 0.8, scope_eligible: false, scope_basis: "", transformation_eligible: false, scope_fields_complete: true, creature_type: "", original_form: "", qualification_evidence: [], subject_key: "young-swordsman", identity_basis: "" }] };
    const executor = new LibraryImportExecutor({ database: postgres.db, adapter: new FakeDifyAdapter([{ target: "l2-index", invocationKey: first.claimed.stepId, output: ordinary }]), cipher: first.cipher, hmacKey: Buffer.from("hmac") });
    expect(await executor.execute(first.claimed)).toEqual({ disposition: "completed" });
    expect((await postgres.db.selectFrom("job_steps").select("output_ref").where("id", "=", first.claimed.stepId).executeTakeFirstOrThrow()).output_ref).toMatchObject({ acceptedCount: 0, candidateCount: 0, rejectedCount: 1 });
    const snapshot = await postgres.db.selectFrom("l2_chapter_statuses").select("input_signature").where("group_id", "=", first.group.id).executeTakeFirstOrThrow();
    const original = await postgres.db.selectFrom("jobs").select(["scope", "config_snapshot"]).where("id", "=", first.claimed.jobId).executeTakeFirstOrThrow();
    const job = await postgres.db.insertInto("jobs").values({ type: "l2-index", status: "queued", requested_by: userId, request_id: crypto.randomUUID(), scope: original.scope, config_snapshot: original.config_snapshot, concurrency_key: null, progress: { total: 1, completed: 0, failed: 0, skipped: 0, current: "" } }).returning("id").executeTakeFirstOrThrow();
    await postgres.db.insertInto("job_steps").values({ job_id: job.id, position: 1, kind: "l2-index", status: "queued", input_signature: snapshot.input_signature, idempotency_key: `${job.id}:l2`, output_ref: null, lease_owner: null, lease_expires_at: null }).execute();
    const skipClaim = (await new PostgresStepLeaseService({ database: postgres.db }).claimNext(job.id, "worker", new Date()))!;
    const noCalls = new FakeDifyAdapter([]);
    expect(await new LibraryImportExecutor({ database: postgres.db, adapter: noCalls, cipher: first.cipher, hmacKey: Buffer.from("hmac") }).execute(skipClaim)).toEqual({ disposition: "completed" });
    expect(noCalls.calls).toEqual([]);
    expect((await postgres.db.selectFrom("jobs").select("progress").where("id", "=", job.id).executeTakeFirstOrThrow()).progress.skipped).toBe(1);

    await postgres.db.deleteFrom("jobs").where("id", "in", [first.claimed.jobId, job.id]).execute();
    await postgres.db.deleteFrom("chapters").where("id", "=", first.chapter.id).execute();
    const failed = await claimL2("people");
    const malformed = { runL2Index: async () => ({ chapter_index: 1, chapter_title: "L2 One", facts: [{ secret: "NEVER_STORE" }] }) } as unknown as DifyAdapter;
    expect(await new LibraryImportExecutor({ database: postgres.db, adapter: malformed, cipher: failed.cipher, hmacKey: Buffer.from("hmac") }).execute(failed.claimed)).toEqual({ disposition: "failed" });
    expect((await postgres.db.selectFrom("l2_chapter_statuses").select(["status", "failure_code"]).where("group_id", "=", failed.group.id).executeTakeFirstOrThrow())).toEqual({ status: "failed", failure_code: "provider_invalid_response" });
    expect(JSON.stringify(await postgres.db.selectFrom("job_attempts").selectAll().where("id", "=", failed.claimed.attemptId).executeTakeFirstOrThrow())).not.toContain("NEVER_STORE");
  });

  it("decrypts one L1 chapter in memory and atomically stores the validated route and references", async () => {
    const { claimed, chapter, cipher, jobs, prompt } = await claimL1();
    const route = { route_schema_version: L1_ROUTE_SCHEMA_VERSION, route_entities: [], route_keywords: ["keyword"], signals: [], category_scores: {} };
    const adapter = new FakeDifyAdapter([{ target: "l1-index", invocationKey: claimed.stepId, output: route }]);
    const executor = new LibraryImportExecutor({ database: postgres.db, adapter, cipher, hmacKey: Buffer.from("hmac") });
    const dispatched = createWorkerStepExecutor({ database: postgres.db, libraryExecutor: executor });
    expect(await dispatched.execute(claimed)).toEqual({ disposition: "completed" });
    expect(adapter.calls[0]).toMatchObject({ target: "l1-index", input: { chapterContent: "L1_SECRET_BODY", indexPrompt: prompt } });
    const current = await postgres.db.selectFrom("l1_indexes").selectAll().where("chapter_id", "=", chapter.id).where("is_current", "=", true).executeTakeFirstOrThrow();
    expect(current).toMatchObject({ status: "fresh", route });
    const step = await postgres.db.selectFrom("job_steps").select(["status", "output_ref"]).where("id", "=", claimed.stepId).executeTakeFirstOrThrow();
    expect(step).toEqual({ status: "completed", output_ref: { l1IndexId: current.id, chapterId: chapter.id, chapterIndex: 1 } });
    expect(await jobs.preview({ bookId })).toMatchObject({ fresh: 1, missing: 0, failed: 0, stale: 0, executable: 0 });
    const publicEffects = JSON.stringify({ step, events: await postgres.db.selectFrom("job_events").selectAll().where("job_id", "=", claimed.jobId).execute(), scope: await postgres.db.selectFrom("jobs").select("scope").where("id", "=", claimed.jobId).executeTakeFirstOrThrow() });
    expect(publicEffects).not.toContain("L1_SECRET_BODY");
    expect(publicEffects).not.toContain(prompt);
    expect(publicEffects).not.toContain("keyword");
    expect(await executor.execute(claimed)).toEqual({ disposition: "already-completed" });
    expect(await postgres.db.selectFrom("l1_indexes").select("id").where("chapter_id", "=", chapter.id).execute()).toHaveLength(1);
  });

  it("skips a now-fresh L1 chapter and commits one failed gap for structural errors while discarding cancelled late output", async () => {
    const first = await claimL1();
    const snapshot = await postgres.db.selectFrom("jobs").select("config_snapshot").where("id", "=", first.claimed.jobId).executeTakeFirstOrThrow();
    const config = snapshot.config_snapshot;
    const prompt = config.prompt as { id: string };
    const workflow = config.workflow as { id: string };
    const inputSignature = (await postgres.db.selectFrom("job_steps").select("input_signature").where("id", "=", first.claimed.stepId).executeTakeFirstOrThrow()).input_signature;
    await createIndexRepository(postgres.db, first.cipher).putL1Index({ chapterId: first.chapter.id, promptVersionId: prompt.id, workflowVersionId: workflow.id, inputSignature, status: "fresh", route: { route_schema_version: L1_ROUTE_SCHEMA_VERSION } });
    const noCalls = new FakeDifyAdapter([]);
    expect(await new LibraryImportExecutor({ database: postgres.db, adapter: noCalls, cipher: first.cipher, hmacKey: Buffer.from("hmac") }).execute(first.claimed)).toEqual({ disposition: "completed" });
    expect(noCalls.calls).toEqual([]);
    expect((await postgres.db.selectFrom("jobs").select("progress").where("id", "=", first.claimed.jobId).executeTakeFirstOrThrow()).progress.skipped).toBe(1);

    await postgres.db.deleteFrom("jobs").where("id", "=", first.claimed.jobId).execute();
    await postgres.db.updateTable("l1_indexes").set({ status: "stale" }).where("chapter_id", "=", first.chapter.id).execute();
    const l2Prompt = await postgres.db.insertInto("prompt_versions").values({ target: "l2-index", version: "l2-failure", content_hash: "legacy" }).returning("id").executeTakeFirstOrThrow();
    const group = await postgres.db.insertInto("index_groups").values({ book_id: bookId, key: "failure-group", name: "Failure group", prompt_version_id: l2Prompt.id, config_hash: "config" }).returning("id").executeTakeFirstOrThrow();
    await postgres.db.insertInto("l2_chapter_statuses").values({ group_id: group.id, chapter_id: first.chapter.id, book_id: bookId, input_signature: "old-l1", status: "fresh", failure_code: null }).execute();
    const jobs = new L1JobService(postgres.db);
    const failedPreview = await jobs.preview({ bookId });
    const failedJob = await jobs.create({ bookId, requestedBy: userId, requestId: "structural", scopeHash: failedPreview.scopeHash });
    const failedClaim = (await new PostgresStepLeaseService({ database: postgres.db }).claimNext(failedJob.id, "worker", new Date()))!;
    const malformed = { runL1Index: async () => ({ route_schema_version: "wrong" }) } as unknown as DifyAdapter;
    expect(await new LibraryImportExecutor({ database: postgres.db, adapter: malformed, cipher: first.cipher, hmacKey: Buffer.from("hmac") }).execute(failedClaim)).toEqual({ disposition: "failed" });
    expect(await jobs.preview({ bookId })).toMatchObject({ failed: 1, executable: 1 });
    expect((await postgres.db.selectFrom("job_attempts").select("error_code").where("id", "=", failedClaim.attemptId).executeTakeFirstOrThrow()).error_code).toBe("provider_invalid_response");
    expect((await postgres.db.selectFrom("l2_chapter_statuses").select("status").where("group_id", "=", group.id).executeTakeFirstOrThrow()).status).toBe("stale");

    await postgres.db.deleteFrom("jobs").where("id", "=", failedJob.id).execute();
    const latePreview = await jobs.preview({ bookId });
    const lateJob = await jobs.create({ bookId, requestedBy: userId, requestId: "late", scopeHash: latePreview.scopeHash });
    const lateClaim = (await new PostgresStepLeaseService({ database: postgres.db }).claimNext(lateJob.id, "worker", new Date()))!;
    await postgres.db.updateTable("jobs").set({ status: "cancelled" }).where("id", "=", lateJob.id).execute();
    const route = { route_schema_version: L1_ROUTE_SCHEMA_VERSION, route_entities: [], route_keywords: ["late-secret-route"], signals: [], category_scores: {} };
    const late = new FakeDifyAdapter([{ target: "l1-index", invocationKey: lateClaim.stepId, output: route }]);
    expect(await new LibraryImportExecutor({ database: postgres.db, adapter: late, cipher: first.cipher, hmacKey: Buffer.from("hmac") }).execute(lateClaim)).toEqual({ disposition: "discarded-cancelled" });
    expect(JSON.stringify(await postgres.db.selectFrom("l1_indexes").select("route").where("chapter_id", "=", first.chapter.id).execute())).not.toContain("late-secret-route");
  });

  it("rechecks chapter freshness inside a provider-free skip commit", async () => {
    const first = await claimL1();
    const config = (await postgres.db.selectFrom("jobs").select("config_snapshot").where("id", "=", first.claimed.jobId).executeTakeFirstOrThrow()).config_snapshot;
    const prompt = config.prompt as { id: string };
    const workflow = config.workflow as { id: string };
    const inputSignature = (await postgres.db.selectFrom("job_steps").select("input_signature").where("id", "=", first.claimed.stepId).executeTakeFirstOrThrow()).input_signature;
    await createIndexRepository(postgres.db, first.cipher).putL1Index({ chapterId: first.chapter.id, promptVersionId: prompt.id, workflowVersionId: workflow.id, inputSignature, status: "fresh", route: { route_schema_version: L1_ROUTE_SCHEMA_VERSION } });
    let locked!: () => void;
    const hasLock = new Promise<void>((resolve) => { locked = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const changing = postgres.db.transaction().execute(async (transaction) => {
      await transaction.selectFrom("chapters").select("id").where("id", "=", first.chapter.id).forUpdate().executeTakeFirstOrThrow();
      locked();
      await gate;
      await transaction.updateTable("chapters").set({ content_hmac: "changed-during-skip" }).where("id", "=", first.chapter.id).execute();
    });
    await hasLock;
    const adapter = new FakeDifyAdapter([]);
    const executing = new LibraryImportExecutor({ database: postgres.db, adapter, cipher: first.cipher, hmacKey: Buffer.from("hmac") }).execute(first.claimed);
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    await changing;
    expect(await executing).toEqual({ disposition: "failed" });
    expect(adapter.calls).toEqual([]);
    expect((await postgres.db.selectFrom("job_steps").select("status").where("id", "=", first.claimed.stepId).executeTakeFirstOrThrow()).status).toBe("failed");
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
