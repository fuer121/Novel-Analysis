import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "kysely";

import { createAnalysisRepository, createContentCipher, createIndexRepository, createLibraryRepository } from "@novel-analysis/database";
import { createDisposablePostgres, type DisposablePostgres } from "../../../packages/database/src/testing/postgres.js";
import { DifyAdapterError, FakeDifyAdapter } from "@novel-analysis/dify";
import { AnalysisJobService, JobControls, PostgresStepLeaseService } from "@novel-analysis/jobs";

import { AnalysisExecutor } from "./analysis-executor.js";
import { BACKGROUND_WAKE_QUEUE, JobWorker, type WorkerBoss } from "./worker.js";

const cipher = createContentCipher({ activeKeyVersion: "test", keys: { test: Buffer.alloc(32, 31) } });
const executionConfig = { model: "analysis-model", reasoningEffort: "high", executorVersion: "analysis-executor-v1" };

describe("analysis executor", () => {
  let postgres: DisposablePostgres;
  let ownerId: string;
  let bookId: string;
  let groupId: string;
  let chapterIds: string[];
  let templateId: string;

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    ownerId = (await postgres.db.insertInto("users").values({ display_name: "Owner", role: "member", status: "active" }).returning("id").executeTakeFirstOrThrow()).id;
    const library = createLibraryRepository(postgres.db, cipher);
    const indexes = createIndexRepository(postgres.db, cipher);
    bookId = (await library.createBook({ title: "Book", createdBy: ownerId })).id;
    const groupPrompt = await indexes.createPromptVersion({ target: "l2-index", version: "l2-v1", content: "index", contentHash: createHash("sha256").update("index").digest("hex") });
    groupId = (await indexes.createIndexGroup({ bookId, key: "people", name: "People", categoryScope: "general", promptVersionId: groupPrompt.id, configHash: "group-v1" })).id;
    await indexes.createWorkflowVersion({ target: "analysis-summary", contractVersion: "summary-v1", dslHash: "summary-dsl-v1" });
    chapterIds = [];
    for (let position = 1; position <= 2; position += 1) {
      chapterIds.push((await library.insertChapter({ bookId, chapterIndex: position, title: `Chapter ${position}`, plaintext: `SENTINEL_CHAPTER_${position}`, contentHmac: `hmac-${position}`, sourceVersion: "source-v1" })).id);
    }
    templateId = (await createAnalysisRepository(postgres.db, cipher).createTemplate({
      bookId, createdBy: ownerId, name: "Private", prompt: "SENTINEL_PROMPT",
      outputSchema: { type: "object", properties: { answer: { type: "string", minLength: 1 } }, required: ["answer"], additionalProperties: false },
      contentHash: createHash("sha256").update("template").digest("hex"), indexGroupId: groupId,
    })).id;
  });

  afterEach(async () => postgres.destroy());

  async function createRun(requestId: string) {
    const service = new AnalysisJobService(postgres.db, cipher, executionConfig);
    const input = { bookId, templateId, actor: { id: ownerId, role: "member" as const }, mode: "full_text" as const, startChapter: 1, endChapter: 2 };
    const preview = await service.preview(input);
    return service.create({ ...input, templateVersionId: preview.templateVersionId, scopeHash: preview.scopeHash, requestId });
  }

  async function createClaim(requestId: string, workerId = "worker-a", leaseDurationMs = 30_000) {
    const created = await createRun(requestId);
    const claim = await new PostgresStepLeaseService({ database: postgres.db, leaseDurationMs }).claimNext(created.job.id, workerId, new Date());
    return { ...created, claim: claim! };
  }

  it("cancels a queued analysis Job, step, and run without exposing content or allowing a claim", async () => {
    const created = await createRun("queued-cancel");

    await new JobControls(postgres.db).control({ jobId: created.job.id, actor: { userId: ownerId, role: "member" }, action: "cancel", requestId: "queued-cancel-control" });

    expect((await postgres.db.selectFrom("jobs").select("status").where("id", "=", created.job.id).executeTakeFirstOrThrow()).status).toBe("cancelled");
    expect(await postgres.db.selectFrom("job_steps").select("status").where("job_id", "=", created.job.id).execute()).toEqual([{ status: "cancelled" }]);
    expect((await postgres.db.selectFrom("analysis_runs").select("status").where("id", "=", created.run.id).executeTakeFirstOrThrow()).status).toBe("cancelled");
    await expect(new PostgresStepLeaseService({ database: postgres.db }).claimNext(created.job.id, "late-worker", new Date())).resolves.toBeNull();
    const ordinary = JSON.stringify({
      events: await postgres.db.selectFrom("job_events").selectAll().where("job_id", "=", created.job.id).execute(),
      audit: await postgres.db.selectFrom("audit_logs").selectAll().where("target_id", "=", created.job.id).execute(),
    });
    expect(ordinary).not.toMatch(/SENTINEL_(PROMPT|CHAPTER)/);
  });

  it("dispatches the created analysis outbox row through the registered production background handler", async () => {
    const created = await createRun("production-outbox-wiring");
    const handlers = new Map<string, (jobs: Array<{ data: { jobId: string; outboxId: string } }>) => Promise<unknown>>();
    const sent: Array<{ topic: string; data: { jobId: string; outboxId: string }; singletonKey: string }> = [];
    let notifyEntered!: () => void;
    const entered = new Promise<void>((resolve) => { notifyEntered = resolve; });
    const boss: WorkerBoss = {
      async start() {}, async stop() {}, async createQueue() {}, async offWork() {},
      async work(name, _options, handler) { handlers.set(name, handler as never); return `worker-${name}`; },
      async send(topic, data, options) {
        sent.push({ topic, data, singletonKey: options.singletonKey });
        await handlers.get(topic)?.([{ data }]);
        return "queue-id";
      },
    };
    const worker = new JobWorker({
      database: postgres.db,
      workerId: "production-wiring-worker",
      boss,
      pollIntervalMs: 60_000,
      executor: {
        async execute(claim) {
          expect(claim).toMatchObject({ jobId: created.job.id, kind: "advanced-analysis" });
          notifyEntered();
          return { disposition: "paused-boundary" };
        },
      },
    });

    try {
      await worker.start();
      await expect(Promise.race([
        entered,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("advanced analysis wake was not consumed")), 500)),
      ])).resolves.toBeUndefined();
      await expect.poll(async () => (await postgres.db.selectFrom("job_outbox").select("delivered_at").where("job_id", "=", created.job.id).executeTakeFirstOrThrow()).delivered_at).toBeInstanceOf(Date);
      const outbox = await postgres.db.selectFrom("job_outbox").select(["id", "topic", "delivered_at"]).where("job_id", "=", created.job.id).executeTakeFirstOrThrow();
      expect(sent).toEqual([{ topic: BACKGROUND_WAKE_QUEUE, data: { jobId: created.job.id, outboxId: outbox.id }, singletonKey: `outbox:${outbox.id}` }]);
      expect(outbox).toMatchObject({ topic: BACKGROUND_WAKE_QUEUE, delivered_at: expect.any(Date) });
    } finally {
      await worker.stop();
    }
  });

  it.each(["completed", "failed"] as const)("does not overwrite a %s analysis run when its Job is cancelled", async (terminalStatus) => {
    const created = await createRun(`terminal-run-${terminalStatus}`);
    const encrypted = cipher.encrypt(JSON.stringify({ answer: "TERMINAL_RESULT" }));
    await postgres.db.updateTable("analysis_runs").set(terminalStatus === "completed" ? {
      status: terminalStatus,
      result_ciphertext: encrypted.ciphertext,
      result_nonce: encrypted.nonce,
      result_tag: encrypted.tag,
      result_key_version: encrypted.keyVersion,
    } : { status: terminalStatus }).where("id", "=", created.run.id).execute();

    await new JobControls(postgres.db).control({ jobId: created.job.id, actor: { userId: ownerId, role: "member" }, action: "cancel", requestId: `cancel-${terminalStatus}-run` });

    expect((await postgres.db.selectFrom("analysis_runs").select("status").where("id", "=", created.run.id).executeTakeFirstOrThrow()).status).toBe(terminalStatus);
  });

  it("commits encrypted parts and a schema-valid final result atomically", async () => {
    const { run, claim } = await createClaim("complete");
    const dify = new FakeDifyAdapter([
      { target: "analysis-summary", invocationKey: `${run.id}:part:1`, output: { text: "PART_SENTINEL_1" } },
      { target: "analysis-summary", invocationKey: `${run.id}:part:2`, output: { text: "PART_SENTINEL_2" } },
      { target: "analysis-summary", invocationKey: `${run.id}:hierarchical:0`, output: { text: "HIERARCHICAL_SENTINEL" } },
      { target: "analysis-summary", invocationKey: `${run.id}:final`, output: { text: JSON.stringify({ answer: "FINAL_SENTINEL" }) } },
    ]);

    await expect(new AnalysisExecutor({ database: postgres.db, cipher, dify, executionConfig }).execute(claim)).resolves.toEqual({ disposition: "completed" });

    const detail = await createAnalysisRepository(postgres.db, cipher).getRunResult({ runId: run.id, actor: { id: ownerId, role: "member" } });
    expect(detail).toEqual({ answer: "FINAL_SENTINEL" });
    expect(await postgres.db.selectFrom("analysis_parts").select("id").where("run_id", "=", run.id).where("kind", "=", "analysis-part").where("status", "=", "completed").execute()).toHaveLength(2);
    expect(await postgres.db.selectFrom("analysis_parts").select(["kind", "position", "status"]).where("run_id", "=", run.id).where("kind", "in", ["analysis-hierarchical-summary", "analysis-final"]).orderBy("position").execute()).toEqual([
      { kind: "analysis-hierarchical-summary", position: 0, status: "completed" },
      { kind: "analysis-final", position: 3, status: "completed" },
    ]);
    const ordinary = JSON.stringify({
      run: await postgres.db.selectFrom("analysis_runs").selectAll().where("id", "=", run.id).executeTakeFirstOrThrow(),
      parts: await postgres.db.selectFrom("analysis_parts").selectAll().where("run_id", "=", run.id).execute(),
      job: await postgres.db.selectFrom("jobs").selectAll().where("id", "=", claim.jobId).executeTakeFirstOrThrow(),
      steps: await postgres.db.selectFrom("job_steps").selectAll().where("job_id", "=", claim.jobId).execute(),
      attempts: await postgres.db.selectFrom("job_attempts").selectAll().where("step_id", "=", claim.stepId).execute(),
      events: await postgres.db.selectFrom("job_events").selectAll().where("job_id", "=", claim.jobId).execute(),
      outbox: await postgres.db.selectFrom("job_outbox").selectAll().where("job_id", "=", claim.jobId).execute(),
    });
    expect(ordinary).not.toMatch(/SENTINEL_(PROMPT|CHAPTER)|PART_SENTINEL|HIERARCHICAL_SENTINEL|FINAL_SENTINEL/);
  });

  it("keeps completed parts reusable after a sanitized provider failure", async () => {
    const { run, claim } = await createClaim("partial");
    const first = new FakeDifyAdapter([
      { target: "analysis-summary", invocationKey: `${run.id}:part:1`, output: { text: "REUSABLE_PART" } },
      { target: "analysis-summary", invocationKey: `${run.id}:part:2`, error: new DifyAdapterError("provider_timeout") },
    ]);
    await expect(new AnalysisExecutor({ database: postgres.db, cipher, dify: first, executionConfig }).execute(claim)).resolves.toEqual({ disposition: "failed" });
    expect((await postgres.db.selectFrom("analysis_parts").select(["status", "error_code"]).where("run_id", "=", run.id).orderBy("position").execute())).toEqual([
      { status: "completed", error_code: null }, { status: "failed", error_code: "provider_timeout" },
    ]);
    expect(JSON.stringify(await postgres.db.selectFrom("job_attempts").select(["error_code", "error_message"]).where("id", "=", claim.attemptId).executeTakeFirstOrThrow())).not.toContain("Dify provider");
  });

  it("rejects invalid final JSON and runtime configuration mismatch", async () => {
    const invalid = await createClaim("invalid-schema");
    const dify = new FakeDifyAdapter([
      { target: "analysis-summary", invocationKey: `${invalid.run.id}:part:1`, output: { text: "one" } },
      { target: "analysis-summary", invocationKey: `${invalid.run.id}:part:2`, output: { text: "two" } },
      { target: "analysis-summary", invocationKey: `${invalid.run.id}:hierarchical:0`, output: { text: "hierarchical" } },
      { target: "analysis-summary", invocationKey: `${invalid.run.id}:final`, output: { text: JSON.stringify({ wrong: true }) } },
    ]);
    await expect(new AnalysisExecutor({ database: postgres.db, cipher, dify, executionConfig }).execute(invalid.claim)).resolves.toEqual({ disposition: "failed" });
    expect((await postgres.db.selectFrom("analysis_runs").select(["status", "result_ciphertext", "error_code"]).where("id", "=", invalid.run.id).executeTakeFirstOrThrow())).toEqual({ status: "failed", result_ciphertext: null, error_code: "invalid_output_schema" });

    const mismatch = await createClaim("config-mismatch");
    await expect(new AnalysisExecutor({ database: postgres.db, cipher, dify: new FakeDifyAdapter([]), executionConfig: { ...executionConfig, model: "other" } }).execute(mismatch.claim)).resolves.toEqual({ disposition: "failed" });
    expect((await postgres.db.selectFrom("analysis_runs").select("error_code").where("id", "=", mismatch.run.id).executeTakeFirstOrThrow()).error_code).toBe("configuration_error");
  });

  it("pauses only after an atomic part boundary", async () => {
    const created = await createClaim("pause");
    const calls: string[] = [];
    const dify = {
      async runAnalysisSummary(input: { invocationKey: string }) {
        calls.push(input.invocationKey);
        await new JobControls(postgres.db).control({ jobId: created.job.id, actor: { userId: ownerId, role: "member" }, action: "pause", requestId: "pause-boundary" });
        return { text: "FIRST_PART" };
      },
      async runChapterImport(): Promise<never> { throw new Error("unexpected"); }, async runL1Index(): Promise<never> { throw new Error("unexpected"); }, async runL2Index(): Promise<never> { throw new Error("unexpected"); },
    };

    await expect(new AnalysisExecutor({ database: postgres.db, cipher, dify, executionConfig }).execute(created.claim)).resolves.toEqual({ disposition: "paused-boundary" });
    expect(calls).toEqual([`${created.run.id}:part:1`]);
    expect(await postgres.db.selectFrom("analysis_parts").select(["position", "status"]).where("run_id", "=", created.run.id).orderBy("position").execute()).toEqual([{ position: 1, status: "completed" }, { position: 2, status: "queued" }]);
    expect((await postgres.db.selectFrom("analysis_runs").select("status").where("id", "=", created.run.id).executeTakeFirstOrThrow()).status).toBe("paused");
  });

  it("keeps the production Worker step recoverable across pause and resume", async () => {
    const created = await createClaim("worker-pause-resume", "pause-seed", 5_000);
    await postgres.db.updateTable("job_steps").set({ lease_expires_at: new Date(0) }).where("id", "=", created.claim.stepId).execute();
    let shouldPause = true;
    const calls: string[] = [];
    const provider = {
      async runAnalysisSummary(input: { invocationKey: string }) {
        calls.push(input.invocationKey);
        if (shouldPause) {
          shouldPause = false;
          await new JobControls(postgres.db).control({ jobId: created.job.id, actor: { userId: ownerId, role: "member" }, action: "pause", requestId: "worker-pause" });
        }
        return { text: input.invocationKey.endsWith(":final") ? JSON.stringify({ answer: "RESUMED_FINAL" }) : "checkpoint" };
      },
      async runChapterImport(): Promise<never> { throw new Error("unexpected"); }, async runL1Index(): Promise<never> { throw new Error("unexpected"); }, async runL2Index(): Promise<never> { throw new Error("unexpected"); },
    };
    const worker = new JobWorker({ database: postgres.db, workerId: "pause-worker", executor: new AnalysisExecutor({ database: postgres.db, cipher, dify: provider, executionConfig }) });

    await worker.processJob(created.job.id);
    expect((await postgres.db.selectFrom("jobs").select("status").where("id", "=", created.job.id).executeTakeFirstOrThrow()).status).toBe("paused");
    expect((await postgres.db.selectFrom("job_steps").select("status").where("id", "=", created.claim.stepId).executeTakeFirstOrThrow()).status).toBe("running");
    expect((await postgres.db.selectFrom("job_attempts").select("status").where("step_id", "=", created.claim.stepId).orderBy("attempt_no", "desc").executeTakeFirstOrThrow()).status).toBe("running");
    expect((await postgres.db.selectFrom("analysis_runs").select("status").where("id", "=", created.run.id).executeTakeFirstOrThrow()).status).toBe("paused");

    await new JobControls(postgres.db).control({ jobId: created.job.id, actor: { userId: ownerId, role: "member" }, action: "resume", requestId: "worker-resume" });
    await postgres.db.updateTable("job_steps").set({ lease_expires_at: new Date(0) }).where("id", "=", created.claim.stepId).execute();
    await worker.processJob(created.job.id);
    expect((await postgres.db.selectFrom("jobs").select("status").where("id", "=", created.job.id).executeTakeFirstOrThrow()).status).toBe("completed");
    expect((await postgres.db.selectFrom("analysis_runs").select("status").where("id", "=", created.run.id).executeTakeFirstOrThrow()).status).toBe("completed");
    expect(calls.filter((key) => key.endsWith(":part:1"))).toHaveLength(1);
  });

  it("cancels a production Worker graph after it exits at a pause boundary", async () => {
    const created = await createClaim("worker-pause-cancel", "pause-cancel-seed", 5_000);
    await postgres.db.updateTable("job_steps").set({ lease_expires_at: new Date(0) }).where("id", "=", created.claim.stepId).execute();
    const provider = {
      async runAnalysisSummary() {
        await new JobControls(postgres.db).control({ jobId: created.job.id, actor: { userId: ownerId, role: "member" }, action: "pause", requestId: "worker-pause-before-cancel" });
        return { text: "PAUSE_BOUNDARY_RESULT" };
      },
      async runChapterImport(): Promise<never> { throw new Error("unexpected"); }, async runL1Index(): Promise<never> { throw new Error("unexpected"); }, async runL2Index(): Promise<never> { throw new Error("unexpected"); },
    };
    const worker = new JobWorker({ database: postgres.db, workerId: "pause-cancel-worker", executor: new AnalysisExecutor({ database: postgres.db, cipher, dify: provider, executionConfig }) });

    await worker.processJob(created.job.id);
    await new JobControls(postgres.db).control({ jobId: created.job.id, actor: { userId: ownerId, role: "member" }, action: "cancel", requestId: "cancel-paused-boundary" });

    expect((await postgres.db.selectFrom("jobs").select("status").where("id", "=", created.job.id).executeTakeFirstOrThrow()).status).toBe("cancelled");
    expect((await postgres.db.selectFrom("job_steps").select("status").where("id", "=", created.claim.stepId).executeTakeFirstOrThrow()).status).toBe("cancelled");
    expect((await postgres.db.selectFrom("job_attempts").select("status").where("step_id", "=", created.claim.stepId).orderBy("attempt_no", "desc").executeTakeFirstOrThrow()).status).toBe("cancelled");
    expect((await postgres.db.selectFrom("analysis_runs").select("status").where("id", "=", created.run.id).executeTakeFirstOrThrow()).status).toBe("cancelled");
    await postgres.db.updateTable("job_steps").set({ lease_expires_at: new Date(0) }).where("id", "=", created.claim.stepId).execute();
    await expect(new PostgresStepLeaseService({ database: postgres.db }).claimNext(created.job.id, "recovery-worker", new Date())).resolves.toBeNull();
  });

  it("cancels without persisting a late provider result", async () => {
    const created = await createClaim("cancel");
    const dify = {
      async runAnalysisSummary() {
        await new JobControls(postgres.db).control({ jobId: created.job.id, actor: { userId: ownerId, role: "member" }, action: "cancel", requestId: "cancel-provider" });
        return { text: "LATE_CANCELLED_SENTINEL" };
      },
      async runChapterImport(): Promise<never> { throw new Error("unexpected"); }, async runL1Index(): Promise<never> { throw new Error("unexpected"); }, async runL2Index(): Promise<never> { throw new Error("unexpected"); },
    };

    await expect(new AnalysisExecutor({ database: postgres.db, cipher, dify, executionConfig }).execute(created.claim)).resolves.toEqual({ disposition: "discarded-cancelled" });
    expect((await postgres.db.selectFrom("analysis_runs").select("status").where("id", "=", created.run.id).executeTakeFirstOrThrow()).status).toBe("cancelled");
    expect(JSON.stringify(await postgres.db.selectFrom("analysis_parts").selectAll().where("run_id", "=", created.run.id).execute())).not.toContain("LATE_CANCELLED_SENTINEL");
  });

  it("rejects a part whose frozen input signature no longer matches", async () => {
    const created = await createClaim("signature");
    await postgres.db.updateTable("analysis_parts").set({ input_signature: "mismatch" }).where("run_id", "=", created.run.id).where("position", "=", 1).execute();
    const dify = new FakeDifyAdapter([{ target: "analysis-summary", invocationKey: `${created.run.id}:part:1`, output: { text: "MUST_NOT_COMMIT" } }]);

    await expect(new AnalysisExecutor({ database: postgres.db, cipher, dify, executionConfig }).execute(created.claim)).resolves.toEqual({ disposition: "terminal-noop" });
    expect((await postgres.db.selectFrom("analysis_parts").select(["status", "result_ciphertext"]).where("run_id", "=", created.run.id).where("position", "=", 1).executeTakeFirstOrThrow())).toEqual({ status: "queued", result_ciphertext: null });
  });

  it("reuses a committed part after lease expiry and rejects the superseded attempt", async () => {
    const created = await createClaim("lease-recovery", "worker-a", 5_000);
    const callsA: string[] = [];
    let partTwoStarted!: () => void;
    const partTwo = new Promise<void>((resolve) => { partTwoStarted = resolve; });
    const difyA = {
      async runAnalysisSummary(input: { invocationKey: string }) {
        callsA.push(input.invocationKey);
        if (input.invocationKey.endsWith(":part:2")) { partTwoStarted(); await new Promise((resolve) => setTimeout(resolve, 80)); }
        return { text: input.invocationKey.endsWith(":part:1") ? "REUSABLE" : "LATE_PART" };
      },
      async runChapterImport(): Promise<never> { throw new Error("unexpected"); }, async runL1Index(): Promise<never> { throw new Error("unexpected"); }, async runL2Index(): Promise<never> { throw new Error("unexpected"); },
    };
    const runningA = new AnalysisExecutor({ database: postgres.db, cipher, dify: difyA, executionConfig }).execute(created.claim);
    await partTwo;
    await postgres.db.updateTable("job_steps").set({ lease_expires_at: new Date(0) }).where("id", "=", created.claim.stepId).execute();
    const claimB = (await new PostgresStepLeaseService({ database: postgres.db, leaseDurationMs: 1_000 }).claimNext(created.job.id, "worker-b", new Date()))!;
    const difyB = new FakeDifyAdapter([
      { target: "analysis-summary", invocationKey: `${created.run.id}:part:2`, output: { text: "AUTHORITATIVE_PART" } },
      { target: "analysis-summary", invocationKey: `${created.run.id}:hierarchical:0`, output: { text: "AUTHORITATIVE_HIERARCHICAL" } },
      { target: "analysis-summary", invocationKey: `${created.run.id}:final`, output: { text: JSON.stringify({ answer: "AUTHORITATIVE_FINAL" }) } },
    ]);

    await expect(new AnalysisExecutor({ database: postgres.db, cipher, dify: difyB, executionConfig }).execute(claimB)).resolves.toEqual({ disposition: "completed" });
    await expect(runningA).resolves.toMatchObject({ disposition: expect.stringMatching(/already-completed|terminal-noop/) });
    expect(callsA.filter((key) => key.endsWith(":part:1"))).toHaveLength(1);
    expect(difyB.calls.map((call) => call.invocationKey)).not.toContain(`${created.run.id}:part:1`);
    expect(await createAnalysisRepository(postgres.db, cipher).getRunResult({ runId: created.run.id, actor: { id: ownerId, role: "member" } })).toEqual({ answer: "AUTHORITATIVE_FINAL" });
  });

  it("uses frozen L1 and L2 after current indexes are rebuilt and decrypts no chapters in fast mode", async () => {
    const indexes = createIndexRepository(postgres.db, cipher);
    const l1Prompt = await indexes.createPromptVersion({ target: "l1-index", version: "l1-v1", content: "l1", contentHash: createHash("sha256").update("l1").digest("hex") });
    const l1Workflow = await indexes.createWorkflowVersion({ target: "l1-index", contractVersion: "l1-v1", dslHash: "l1-v1" });
    for (let position = 1; position <= 2; position += 1) {
      await indexes.putL1Index({ chapterId: chapterIds[position - 1]!, promptVersionId: l1Prompt.id, workflowVersionId: l1Workflow.id, inputSignature: `old-l1-${position}`, status: "fresh", route: { route_schema_version: "l1-route-v1", route_entities: [], route_keywords: [`OLD_ROUTE_${position}`], signals: [], category_scores: {} } });
      await indexes.putL2ChapterStatus({ groupId, chapterId: chapterIds[position - 1]!, inputSignature: `old-l2-${position}`, status: "fresh" });
      await indexes.registerSubject({ groupId, subjectKey: `subject-${position}`, displayName: `Subject ${position}`, aliases: [] });
      await indexes.addFact({ groupId, chapterId: chapterIds[position - 1]!, subjectKey: `subject-${position}`, factType: "event", plaintext: `OLD_FACT_${position}`, metadata: { importance: 1, confidence: 1 } });
    }
    const service = new AnalysisJobService(postgres.db, cipher, executionConfig);
    const input = { bookId, templateId, actor: { id: ownerId, role: "member" as const }, mode: "fast_index" as const, startChapter: 1, endChapter: 2 };
    const preview = await service.preview(input);
    const created = await service.create({ ...input, templateVersionId: preview.templateVersionId, scopeHash: preview.scopeHash, requestId: "frozen-indexes" });
    const claim = (await new PostgresStepLeaseService({ database: postgres.db }).claimNext(created.job.id, "snapshot-worker", new Date()))!;

    await postgres.db.deleteFrom("l2_facts").where("group_id", "=", groupId).execute();
    for (let position = 1; position <= 2; position += 1) {
      await indexes.putL1Index({ chapterId: chapterIds[position - 1]!, promptVersionId: l1Prompt.id, workflowVersionId: l1Workflow.id, inputSignature: `new-l1-${position}`, status: "fresh", route: { route_schema_version: "l1-route-v1", route_entities: [], route_keywords: [`NEW_ROUTE_${position}`], signals: [], category_scores: {} } });
      await indexes.addFact({ groupId, chapterId: chapterIds[position - 1]!, subjectKey: `subject-${position}`, factType: "event", plaintext: `NEW_FACT_${position}`, metadata: { importance: 1, confidence: 1 } });
    }
    const contexts: string[] = [];
    const dify = {
      async runAnalysisSummary(providerInput: { invocationKey: string; contextJson: string }) { contexts.push(providerInput.contextJson); return { text: providerInput.invocationKey.endsWith(":final") ? JSON.stringify({ answer: "FROZEN" }) : "part" }; },
      async runChapterImport(): Promise<never> { throw new Error("unexpected"); }, async runL1Index(): Promise<never> { throw new Error("unexpected"); }, async runL2Index(): Promise<never> { throw new Error("unexpected"); },
    };

    await expect(new AnalysisExecutor({ database: postgres.db, cipher, dify, executionConfig }).execute(claim)).resolves.toEqual({ disposition: "completed" });
    expect(contexts.join("\n")).toContain("OLD_ROUTE_1");
    expect(contexts.join("\n")).toContain("OLD_FACT_2");
    expect(contexts.join("\n")).not.toMatch(/NEW_ROUTE|NEW_FACT|SENTINEL_CHAPTER/);
  });

  it.each(["hierarchical", "final"] as const)("reuses a committed %s checkpoint after crash and lease expiry", async (crashAfter) => {
    const created = await createClaim(`checkpoint-${crashAfter}`, "checkpoint-a", 5_000);
    const calls: string[] = [];
    const dify = {
      async runAnalysisSummary(input: { invocationKey: string }) {
        calls.push(input.invocationKey);
        if (input.invocationKey.endsWith(":final")) return { text: JSON.stringify({ answer: "CHECKPOINT_FINAL" }) };
        return { text: input.invocationKey.includes(":hierarchical:") ? "HIERARCHICAL_CHECKPOINT" : `CHAPTER_${input.invocationKey.at(-1)}` };
      },
      async runChapterImport(): Promise<never> { throw new Error("unexpected"); }, async runL1Index(): Promise<never> { throw new Error("unexpected"); }, async runL2Index(): Promise<never> { throw new Error("unexpected"); },
    };
    const first = new AnalysisExecutor({
      database: postgres.db, cipher, dify, executionConfig,
      checkpointBarrier: { async afterCheckpointCommitted(kind) { if (kind === crashAfter) throw new Error(`crash-after-${kind}`); } },
    }).execute(created.claim);
    await expect(first).rejects.toThrow(`crash-after-${crashAfter}`);
    await postgres.db.updateTable("job_steps").set({ lease_expires_at: new Date(0) }).where("id", "=", created.claim.stepId).execute();
    const claimB = (await new PostgresStepLeaseService({ database: postgres.db, leaseDurationMs: 1_000 }).claimNext(created.job.id, "checkpoint-b", new Date()))!;

    await expect(new AnalysisExecutor({ database: postgres.db, cipher, dify, executionConfig }).execute(claimB)).resolves.toEqual({ disposition: "completed" });
    expect(calls.filter((key) => key.includes(":hierarchical:"))).toHaveLength(1);
    expect(calls.filter((key) => key.endsWith(":final"))).toHaveLength(1);
    expect(await postgres.db.selectFrom("analysis_parts").select(["kind", "position", "status"]).where("run_id", "=", created.run.id).where("kind", "in", ["analysis-hierarchical-summary", "analysis-final"]).orderBy("position").execute()).toEqual([
      { kind: "analysis-hierarchical-summary", position: 0, status: "completed" },
      { kind: "analysis-final", position: 3, status: "completed" },
    ]);
    expect((await postgres.db.selectFrom("analysis_runs").select(["completed_parts", "total_parts", "status"]).where("id", "=", created.run.id).executeTakeFirstOrThrow())).toEqual({ completed_parts: 2, total_parts: 2, status: "completed" });
  });

  it("completes once under concurrent repeated wake and exact outbox replay after final checkpoint crash", async () => {
    const created = await createClaim("outbox-final-checkpoint", "outbox-a", 5_000);
    const providerCalls: string[] = [];
    const provider = {
      async runAnalysisSummary(input: { invocationKey: string }) { providerCalls.push(input.invocationKey); return { text: input.invocationKey.endsWith(":final") ? JSON.stringify({ answer: "OUTBOX_FINAL" }) : "checkpoint" }; },
      async runChapterImport(): Promise<never> { throw new Error("unexpected"); }, async runL1Index(): Promise<never> { throw new Error("unexpected"); }, async runL2Index(): Promise<never> { throw new Error("unexpected"); },
    };
    await expect(new AnalysisExecutor({ database: postgres.db, cipher, dify: provider, executionConfig, checkpointBarrier: { async afterCheckpointCommitted(kind) { if (kind === "final") throw new Error("crash-after-final"); } } }).execute(created.claim)).rejects.toThrow("crash-after-final");
    await postgres.db.updateTable("job_steps").set({ lease_expires_at: new Date(0) }).where("id", "=", created.claim.stepId).execute();
    const handlers = new Map<string, (jobs: Array<{ data: { jobId: string; outboxId: string } }>) => Promise<unknown>>();
    const boss: WorkerBoss = {
      async start() {}, async stop() {}, async createQueue() {}, async offWork() {}, async send() { return "id"; },
      async work(name, _options, handler) { handlers.set(name, handler as never); return "id"; },
    };
    const worker = new JobWorker({ database: postgres.db, workerId: "outbox-b", boss, executor: new AnalysisExecutor({ database: postgres.db, cipher, dify: new FakeDifyAdapter([]), executionConfig }), pollIntervalMs: 60_000 });
    const outboxId = (await postgres.db.selectFrom("job_outbox").select("id").where("job_id", "=", created.job.id).executeTakeFirstOrThrow()).id;
    try {
      await worker.start();
      const replay = handlers.get(BACKGROUND_WAKE_QUEUE)!;
      const payload = [{ data: { jobId: created.job.id, outboxId } }];
      await Promise.all([replay(payload), replay(payload), replay([{ data: { jobId: created.job.id, outboxId: "duplicate" } }])]);
    } finally {
      await worker.stop();
    }
    expect(providerCalls.filter((key) => key.endsWith(":final"))).toHaveLength(1);
    expect(await postgres.db.selectFrom("job_events").select("id").where("job_id", "=", created.job.id).where("type", "=", "completed").execute()).toHaveLength(1);
    expect(await postgres.db.selectFrom("analysis_parts").select("id").where("run_id", "=", created.run.id).where("kind", "=", "analysis-final").execute()).toHaveLength(1);
    expect(await createAnalysisRepository(postgres.db, cipher).getRunResult({ runId: created.run.id, actor: { id: ownerId, role: "member" } })).toEqual({ answer: "OUTBOX_FINAL" });
  });

  it("rolls back a rejected hierarchical checkpoint commit without leaking ciphertext", async () => {
    const created = await createClaim("checkpoint-rollback");
    await sql`create function reject_analysis_checkpoint() returns trigger language plpgsql as $$ begin if new.kind = 'analysis-hierarchical-summary' then raise exception 'forced checkpoint rollback'; end if; return new; end $$`.execute(postgres.db);
    await sql`create trigger reject_analysis_checkpoint before insert on analysis_parts for each row execute function reject_analysis_checkpoint()`.execute(postgres.db);
    const provider = {
      async runAnalysisSummary(input: { invocationKey: string }) { return { text: input.invocationKey.includes(":hierarchical:") ? "ROLLBACK_CHECKPOINT_SENTINEL" : "chapter" }; },
      async runChapterImport(): Promise<never> { throw new Error("unexpected"); }, async runL1Index(): Promise<never> { throw new Error("unexpected"); }, async runL2Index(): Promise<never> { throw new Error("unexpected"); },
    };

    await expect(new AnalysisExecutor({ database: postgres.db, cipher, dify: provider, executionConfig }).execute(created.claim)).rejects.toThrow("forced checkpoint rollback");
    expect(await postgres.db.selectFrom("analysis_parts").select("id").where("run_id", "=", created.run.id).where("kind", "=", "analysis-hierarchical-summary").execute()).toEqual([]);
    expect(JSON.stringify(await postgres.db.selectFrom("analysis_parts").selectAll().where("run_id", "=", created.run.id).execute())).not.toContain("ROLLBACK_CHECKPOINT_SENTINEL");
  });

  it("keeps controlled provider errors out of captured Worker logs and audit surfaces", async () => {
    const created = await createClaim("provider-error-scan");
    await postgres.db.updateTable("job_steps").set({ lease_expires_at: new Date(0) }).where("id", "=", created.claim.stepId).execute();
    const captured: string[] = [];
    const original = console.error;
    console.error = (...values: unknown[]) => { captured.push(values.map(String).join(" ")); };
    const provider = {
      async runAnalysisSummary(): Promise<never> { throw new Error("RAW_PROVIDER_ERROR_SENTINEL"); },
      async runChapterImport(): Promise<never> { throw new Error("unexpected"); }, async runL1Index(): Promise<never> { throw new Error("unexpected"); }, async runL2Index(): Promise<never> { throw new Error("unexpected"); },
    };
    try {
      const worker = new JobWorker({ database: postgres.db, workerId: "provider-error-worker", executor: new AnalysisExecutor({ database: postgres.db, cipher, dify: provider, executionConfig }) });
      await expect(worker.processJob(created.job.id)).resolves.toBeUndefined();
    } finally {
      console.error = original;
    }
    const ordinary = JSON.stringify({
      logs: captured,
      audit: await postgres.db.selectFrom("audit_logs").selectAll().execute(),
      attempts: await postgres.db.selectFrom("job_attempts").select(["error_code", "error_message"]).where("step_id", "=", created.claim.stepId).execute(),
      events: await postgres.db.selectFrom("job_events").selectAll().where("job_id", "=", created.job.id).execute(),
    });
    expect(ordinary).not.toContain("RAW_PROVIDER_ERROR_SENTINEL");
    expect(ordinary).toContain("provider_invalid_response");
  });

  it.each(["hierarchical", "final"] as const)("fails safely without provider rebuild for a corrupt reusable %s checkpoint", async (kind) => {
    const created = await createClaim(`corrupt-${kind}`, "corrupt-a", 5_000);
    const providerCalls: string[] = [];
    const provider = {
      async runAnalysisSummary(input: { invocationKey: string }) { providerCalls.push(input.invocationKey); return { text: input.invocationKey.endsWith(":final") ? JSON.stringify({ answer: "CORRUPT_FINAL" }) : "checkpoint" }; },
      async runChapterImport(): Promise<never> { throw new Error("unexpected"); }, async runL1Index(): Promise<never> { throw new Error("unexpected"); }, async runL2Index(): Promise<never> { throw new Error("unexpected"); },
    };
    await expect(new AnalysisExecutor({ database: postgres.db, cipher, dify: provider, executionConfig, checkpointBarrier: { async afterCheckpointCommitted(checkpointKind) { if (checkpointKind === kind) throw new Error("checkpoint-crash"); } } }).execute(created.claim)).rejects.toThrow("checkpoint-crash");
    const partKind = kind === "hierarchical" ? "analysis-hierarchical-summary" : "analysis-final";
    const replacement = kind === "hierarchical" ? cipher.encrypt("not-json") : cipher.encrypt(JSON.stringify({ wrong: "structure" }));
    await postgres.db.updateTable("analysis_parts").set({ result_ciphertext: replacement.ciphertext, result_nonce: replacement.nonce, result_tag: replacement.tag, result_key_version: replacement.keyVersion }).where("run_id", "=", created.run.id).where("kind", "=", partKind).execute();
    await postgres.db.updateTable("job_steps").set({ lease_expires_at: new Date(0) }).where("id", "=", created.claim.stepId).execute();
    const claimB = (await new PostgresStepLeaseService({ database: postgres.db, leaseDurationMs: 1_000 }).claimNext(created.job.id, "corrupt-b", new Date()))!;
    const callsBeforeRetry = providerCalls.length;
    const captured: string[] = [];
    const original = console.error;
    console.error = (...values: unknown[]) => { captured.push(values.map(String).join(" ")); };

    try {
      await expect(new AnalysisExecutor({ database: postgres.db, cipher, dify: provider, executionConfig }).execute(claimB)).resolves.toEqual({ disposition: "failed" });
    } finally {
      console.error = original;
    }
    expect(providerCalls).toHaveLength(callsBeforeRetry);
    expect((await postgres.db.selectFrom("analysis_runs").select("error_code").where("id", "=", created.run.id).executeTakeFirstOrThrow()).error_code).toBe("invalid_execution_checkpoint");
    const ordinary = JSON.stringify({
      logs: captured,
      attempt: await postgres.db.selectFrom("job_attempts").select(["error_code", "error_message"]).where("id", "=", claimB.attemptId).executeTakeFirstOrThrow(),
      events: await postgres.db.selectFrom("job_events").selectAll().where("job_id", "=", created.job.id).execute(),
    });
    expect(ordinary).toContain("invalid_execution_checkpoint");
    expect(ordinary).not.toMatch(/not-json|wrong|structure|CORRUPT_FINAL/);
  });
});
