import { randomBytes, randomUUID } from "node:crypto";

import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";

import type { DatabaseExecutor } from "../db.js";
import { createContentCipher } from "../library/content-encryption.js";
import { createDisposablePostgres, type DisposablePostgres } from "../testing/postgres.js";
import { decryptJson, encryptJson } from "./content.js";
import { createAnalysisRepository, type AnalysisActor } from "./analysis-repository.js";

describe("private analysis repository", () => {
  let postgres: DisposablePostgres;
  const cipher = createContentCipher({ activeKeyVersion: "analysis-v1", keys: { "analysis-v1": randomBytes(32) } });
  let owner: AnalysisActor;
  let member: AnalysisActor;
  let admin: AnalysisActor;
  let bookId: string;

  beforeAll(async () => {
    postgres = await createDisposablePostgres();
    const users = await postgres.db.insertInto("users").values([
      { display_name: "Owner", role: "member", status: "active" },
      { display_name: "Member", role: "member", status: "active" },
      { display_name: "Admin", role: "admin", status: "active" },
    ]).returning(["id", "role"]).execute();
    owner = users[0]!;
    member = users[1]!;
    admin = users[2]!;
    bookId = (await postgres.db.insertInto("books").values({ title: "Book", created_by: owner.id, status: "active" }).returning("id").executeTakeFirstOrThrow()).id;
  });

  afterAll(async () => postgres?.destroy());

  test("does not expose a run completion path before Worker lease authority exists", () => {
    expect(createAnalysisRepository(postgres.db, cipher)).not.toHaveProperty("completeRun");
  });

  test("encrypts template versions and filters all template content by owner", async () => {
    const repository = createAnalysisRepository(postgres.db, cipher);
    const prompt = "analysis-prompt-plaintext-sentinel";
    const outputSchema = { marker: "analysis-schema-plaintext-sentinel", type: "object" };
    const template = await repository.createTemplate({ bookId, createdBy: owner.id, name: "Private", prompt, outputSchema, contentHash: "a".repeat(64), indexGroupId: null });

    expect(await repository.listTemplates({ bookId, actor: owner })).toHaveLength(1);
    expect(await repository.getTemplate({ templateId: template.id, actor: owner })).toMatchObject({ prompt, outputSchema });
    await expect(repository.getTemplate({ templateId: template.id, actor: member })).rejects.toThrow("Analysis access denied");
    await expect(repository.getTemplate({ templateId: template.id, actor: admin })).rejects.toThrow("Analysis access denied");
    expect(await repository.listTemplates({ bookId, actor: member })).toEqual([]);
    expect(await repository.listTemplates({ bookId, actor: admin })).toEqual([]);

    const updatedPrompt = "updated-analysis-prompt-plaintext-sentinel";
    const updated = await repository.updateTemplate({ templateId: template.id, actor: owner, name: "Private v2", prompt: updatedPrompt, outputSchema: { type: "array" }, contentHash: "b".repeat(64), indexGroupId: null });
    expect(updated.currentVersionId).not.toBe(template.currentVersionId);
    expect(await repository.getTemplate({ templateId: template.id, actor: owner })).toMatchObject({ prompt: updatedPrompt, outputSchema: { type: "array" } });
    expect(await postgres.db.selectFrom("analysis_template_versions").select("version").where("template_id", "=", template.id).orderBy("version").execute()).toEqual([{ version: 1 }, { version: 2 }]);

    const raw = await sql<Record<string, unknown>>`select * from analysis_templates t join analysis_template_versions v on v.template_id = t.id where t.id = ${template.id}`.execute(postgres.db);
    expect(JSON.stringify(raw.rows)).not.toContain(prompt);
    expect(JSON.stringify(raw.rows)).not.toContain("analysis-schema-plaintext-sentinel");
    expect(JSON.stringify(raw.rows)).not.toContain(updatedPrompt);
    await expect(sql`update analysis_template_versions set content_hash = ${"b".repeat(64)} where id = ${template.currentVersionId}`.execute(postgres.db)).rejects.toThrow();
    await expect(sql`delete from analysis_template_versions where id = ${template.currentVersionId}`.execute(postgres.db)).rejects.toThrow();
  });

  test("binds valid runs and parts and reuses only exact completed inputs", async () => {
    const repository = createAnalysisRepository(postgres.db, cipher);
    const template = await repository.createTemplate({ bookId, createdBy: owner.id, name: "Run", prompt: "prompt", outputSchema: { type: "object" }, contentHash: "c".repeat(64), indexGroupId: null });
    const job = await postgres.db.insertInto("jobs").values({ type: "advanced-analysis", status: "queued", requested_by: owner.id, request_id: randomUUID(), scope: {}, config_snapshot: {}, progress: {} }).returning("id").executeTakeFirstOrThrow();
    const run = await repository.createRun({ bookId, createdBy: owner.id, templateVersionId: template.currentVersionId, jobId: job.id, mode: "balanced", startChapter: 1, endChapter: 3, status: "queued", executionSignature: "d".repeat(64), totalParts: 2 });
    const part = await repository.createPart({ runId: run.id, position: 0, kind: "chapter", status: "running", inputSignature: "e".repeat(64) });
    expect(await repository.findReusablePart({ runId: run.id, position: 0, kind: "chapter", inputSignature: "e".repeat(64), actor: owner })).toBeNull();

    const result = { marker: "analysis-part-result-plaintext-sentinel", values: [1, 2] };
    await repository.completePart({ partId: part.id, actor: owner, result });
    expect(await repository.findReusablePart({ runId: run.id, position: 0, kind: "chapter", inputSignature: "e".repeat(64), actor: owner })).toMatchObject({ id: part.id, result });
    for (const mismatch of [
      { position: 1, kind: "chapter", inputSignature: "e".repeat(64) },
      { position: 0, kind: "summary", inputSignature: "e".repeat(64) },
      { position: 0, kind: "chapter", inputSignature: "f".repeat(64) },
    ]) expect(await repository.findReusablePart({ runId: run.id, actor: owner, ...mismatch })).toBeNull();
    await expect(repository.findReusablePart({ runId: run.id, position: 0, kind: "chapter", inputSignature: "e".repeat(64), actor: admin })).rejects.toThrow("Analysis access denied");
    const finalResult = { marker: "analysis-final-result-plaintext-sentinel" };
    const encryptedFinalResult = encryptJson(cipher, finalResult);
    await postgres.db.updateTable("analysis_runs").set({ status: "completed", result_ciphertext: encryptedFinalResult.ciphertext, result_nonce: encryptedFinalResult.nonce, result_tag: encryptedFinalResult.tag, result_key_version: encryptedFinalResult.keyVersion }).where("id", "=", run.id).execute();
    expect(await repository.getRunResult({ runId: run.id, actor: owner })).toEqual(finalResult);
    await expect(repository.getRunResult({ runId: run.id, actor: member })).rejects.toThrow("Analysis access denied");
    await expect(repository.getRunResult({ runId: run.id, actor: admin })).rejects.toThrow("Analysis access denied");

    const raw = await postgres.db.selectFrom("analysis_parts").selectAll().where("id", "=", part.id).executeTakeFirstOrThrow();
    expect(raw.status).toBe("completed");
    expect(JSON.stringify(raw)).not.toContain("analysis-part-result-plaintext-sentinel");
    const jsonSurfaces = await sql<Record<string, unknown>>`
      select scope, config_snapshot, progress from jobs where id = ${job.id}
      union all select payload, '{}'::jsonb, '{}'::jsonb from job_events where job_id = ${job.id}
      union all select payload, '{}'::jsonb, '{}'::jsonb from job_outbox where job_id = ${job.id}
      union all select metadata, '{}'::jsonb, '{}'::jsonb from audit_logs where target_id = ${run.id}
      union all select diagnostics, '{}'::jsonb, '{}'::jsonb from analysis_runs where id = ${run.id}
      union all select output_ref, '{}'::jsonb, '{}'::jsonb from analysis_parts where run_id = ${run.id}
    `.execute(postgres.db);
    const ordinaryJson = JSON.stringify(jsonSurfaces.rows);
    expect(ordinaryJson).not.toContain("analysis-prompt-plaintext-sentinel");
    expect(ordinaryJson).not.toContain("analysis-schema-plaintext-sentinel");
    expect(ordinaryJson).not.toContain("analysis-part-result-plaintext-sentinel");
    expect(ordinaryJson).not.toContain("analysis-final-result-plaintext-sentinel");
  });

  test("enforces database constraints and atomic completion", async () => {
    const repository = createAnalysisRepository(postgres.db, cipher);
    const template = await repository.createTemplate({ bookId, createdBy: owner.id, name: "Constraints", prompt: "prompt", outputSchema: {}, contentHash: "1".repeat(64), indexGroupId: null });
    const job = await postgres.db.insertInto("jobs").values({ type: "advanced-analysis", status: "queued", requested_by: owner.id, request_id: randomUUID(), scope: {}, config_snapshot: {}, progress: {} }).returning("id").executeTakeFirstOrThrow();
    await expect(repository.createRun({ bookId, createdBy: owner.id, templateVersionId: template.currentVersionId, jobId: job.id, mode: "bad" as never, startChapter: 3, endChapter: 1, status: "queued", executionSignature: "2".repeat(64), totalParts: 1 })).rejects.toThrow();
    const run = await repository.createRun({ bookId, createdBy: owner.id, templateVersionId: template.currentVersionId, jobId: job.id, mode: "full_text", startChapter: 1, endChapter: 1, status: "queued", executionSignature: "2".repeat(64), totalParts: 1 });
    await expect(sql`insert into analysis_parts (run_id, position, kind, status, input_signature, result_ciphertext) values (${run.id}, 0, 'chapter', 'completed', ${"3".repeat(64)}, ${Buffer.from("partial")})`.execute(postgres.db)).rejects.toThrow();
    const part = await repository.createPart({ runId: run.id, position: 0, kind: "chapter", status: "running", inputSignature: "3".repeat(64) });
    await expect(postgres.db.transaction().execute(async (transaction) => {
      await createAnalysisRepository(transaction, cipher).completePart({ partId: part.id, actor: owner, result: { rollback: true } });
      throw new Error("rollback completion");
    })).rejects.toThrow("rollback completion");
    expect(await postgres.db.selectFrom("analysis_parts").select(["status", "result_ciphertext"]).where("id", "=", part.id).executeTakeFirstOrThrow()).toEqual({ status: "running", result_ciphertext: null });
  });

  test("rejects direct run inserts with mismatched template, book, creator, or Job requester", async () => {
    const repository = createAnalysisRepository(postgres.db, cipher);
    const template = await repository.createTemplate({ bookId, createdBy: owner.id, name: "Identity", prompt: "prompt", outputSchema: {}, contentHash: "4".repeat(64), indexGroupId: null });
    const otherBookId = (await postgres.db.insertInto("books").values({ title: "Other", created_by: member.id, status: "active" }).returning("id").executeTakeFirstOrThrow()).id;
    const jobs = await postgres.db.insertInto("jobs").values([
      { type: "advanced-analysis", status: "queued", requested_by: owner.id, request_id: randomUUID(), scope: {}, config_snapshot: {}, progress: {} },
      { type: "advanced-analysis", status: "queued", requested_by: owner.id, request_id: randomUUID(), scope: {}, config_snapshot: {}, progress: {} },
      { type: "advanced-analysis", status: "queued", requested_by: member.id, request_id: randomUUID(), scope: {}, config_snapshot: {}, progress: {} },
      { type: "advanced-analysis", status: "queued", requested_by: owner.id, request_id: randomUUID(), scope: {}, config_snapshot: {}, progress: {} },
    ]).returning("id").execute();
    const insertRun = (runBookId: string, createdBy: string, jobId: string) => sql`
      insert into analysis_runs (book_id, created_by, template_version_id, job_id, mode, start_chapter, end_chapter, status, execution_signature, total_parts, diagnostics)
      values (${runBookId}, ${createdBy}, ${template.currentVersionId}, ${jobId}, 'balanced', 1, 1, 'queued', ${"5".repeat(64)}, 1, '{}'::jsonb)
    `.execute(postgres.db);

    await expect(insertRun(bookId, member.id, jobs[0]!.id)).rejects.toThrow();
    await expect(insertRun(otherBookId, owner.id, jobs[1]!.id)).rejects.toThrow();
    await expect(insertRun(bookId, owner.id, jobs[2]!.id)).rejects.toThrow();
    await expect(insertRun(bookId, owner.id, jobs[3]!.id)).resolves.toBeDefined();
  });

  test("preserves run identity across parent updates and a concurrent parent-update race", async () => {
    const repository = createAnalysisRepository(postgres.db, cipher);
    const template = await repository.createTemplate({ bookId, createdBy: owner.id, name: "Parent identity", prompt: "prompt", outputSchema: {}, contentHash: "a".repeat(64), indexGroupId: null });
    const otherBookId = (await postgres.db.insertInto("books").values({ title: "Parent other", created_by: member.id, status: "active" }).returning("id").executeTakeFirstOrThrow()).id;
    const job = await postgres.db.insertInto("jobs").values({ type: "advanced-analysis", status: "queued", requested_by: owner.id, request_id: randomUUID(), scope: {}, config_snapshot: {}, progress: {} }).returning("id").executeTakeFirstOrThrow();
    await repository.createRun({ bookId, createdBy: owner.id, templateVersionId: template.currentVersionId, jobId: job.id, mode: "balanced", startChapter: 1, endChapter: 1, status: "queued", executionSignature: "b".repeat(64), totalParts: 1 });

    const rejectedInRollback = async (operation: (transaction: DatabaseExecutor) => Promise<unknown>) => {
      let rejected = false;
      await expect(postgres.db.transaction().execute(async (transaction) => {
        await operation(transaction).catch(() => { rejected = true; });
        throw new Error("rollback parent mutation");
      })).rejects.toThrow("rollback parent mutation");
      expect(rejected).toBe(true);
    };
    await rejectedInRollback((transaction) => transaction.updateTable("analysis_templates").set({ created_by: member.id }).where("id", "=", template.id).execute());
    await rejectedInRollback((transaction) => transaction.updateTable("analysis_templates").set({ book_id: otherBookId }).where("id", "=", template.id).execute());
    await rejectedInRollback((transaction) => transaction.updateTable("jobs").set({ requested_by: member.id }).where("id", "=", job.id).execute());
    await rejectedInRollback((transaction) => transaction.updateTable("jobs").set({ type: "query" }).where("id", "=", job.id).execute());

    const unrelatedTemplate = await repository.createTemplate({ bookId, createdBy: owner.id, name: "Unrelated", prompt: "prompt", outputSchema: {}, contentHash: "c".repeat(64), indexGroupId: null });
    const unrelatedJob = await postgres.db.insertInto("jobs").values({ type: "advanced-analysis", status: "queued", requested_by: owner.id, request_id: randomUUID(), scope: {}, config_snapshot: {}, progress: {} }).returning("id").executeTakeFirstOrThrow();
    await expect(postgres.db.updateTable("analysis_templates").set({ created_by: member.id, book_id: otherBookId }).where("id", "=", unrelatedTemplate.id).execute()).resolves.toBeDefined();
    await expect(postgres.db.updateTable("jobs").set({ requested_by: member.id }).where("id", "=", unrelatedJob.id).execute()).resolves.toBeDefined();

    const racingTemplate = await repository.createTemplate({ bookId, createdBy: owner.id, name: "Race", prompt: "prompt", outputSchema: {}, contentHash: "d".repeat(64), indexGroupId: null });
    const racingJob = await postgres.db.insertInto("jobs").values({ type: "advanced-analysis", status: "queued", requested_by: owner.id, request_id: randomUUID(), scope: {}, config_snapshot: {}, progress: {} }).returning("id").executeTakeFirstOrThrow();
    let releaseParent!: () => void;
    let parentLocked!: () => void;
    const parentLock = new Promise<void>((resolve) => { parentLocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseParent = resolve; });
    const parentUpdate = postgres.db.transaction().execute(async (transaction) => {
      await transaction.updateTable("analysis_templates").set({ created_by: member.id }).where("id", "=", racingTemplate.id).execute();
      parentLocked();
      await release;
    });
    await parentLock;
    const racingInsert = repository.createRun({ bookId, createdBy: owner.id, templateVersionId: racingTemplate.currentVersionId, jobId: racingJob.id, mode: "balanced", startChapter: 1, endChapter: 1, status: "queued", executionSignature: "e".repeat(64), totalParts: 1 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    releaseParent();
    await parentUpdate;
    await expect(racingInsert).rejects.toThrow();
  });

  test("binds only queued advanced-analysis Jobs", async () => {
    const repository = createAnalysisRepository(postgres.db, cipher);
    const template = await repository.createTemplate({ bookId, createdBy: owner.id, name: "Lifecycle", prompt: "prompt", outputSchema: {}, contentHash: "f".repeat(64), indexGroupId: null });
    const createJob = (type: string, status: "queued" | "running" | "retrying" | "paused" | "completed" | "failed" | "cancelled") => postgres.db.insertInto("jobs").values({ type, status, requested_by: owner.id, request_id: randomUUID(), scope: {}, config_snapshot: {}, progress: {} }).returning("id").executeTakeFirstOrThrow();
    const wrongType = await createJob("query", "queued");
    await expect(repository.createRun({ bookId, createdBy: owner.id, templateVersionId: template.currentVersionId, jobId: wrongType.id, mode: "balanced", startChapter: 1, endChapter: 1, status: "queued", executionSignature: randomUUID(), totalParts: 1 })).rejects.toThrow();
    for (const status of ["completed", "failed", "cancelled"] as const) {
      const terminalJob = await createJob("advanced-analysis", status);
      await expect(repository.createRun({ bookId, createdBy: owner.id, templateVersionId: template.currentVersionId, jobId: terminalJob.id, mode: "balanced", startChapter: 1, endChapter: 1, status: "queued", executionSignature: randomUUID(), totalParts: 1 })).rejects.toThrow();
    }

    const validJob = await createJob("advanced-analysis", "queued");
    await expect(repository.createRun({ bookId, createdBy: owner.id, templateVersionId: template.currentVersionId, jobId: validJob.id, mode: "balanced", startChapter: 1, endChapter: 1, status: "queued", executionSignature: randomUUID(), totalParts: 1 })).resolves.toBeDefined();
  });

  test("rejects repository payloads outside the approved JSON schema", async () => {
    const repository = createAnalysisRepository(postgres.db, cipher);
    const template = await repository.createTemplate({ bookId, createdBy: owner.id, name: "Malformed", prompt: "prompt", outputSchema: {}, contentHash: "6".repeat(64), indexGroupId: null });
    const job = await postgres.db.insertInto("jobs").values({ type: "advanced-analysis", status: "queued", requested_by: owner.id, request_id: randomUUID(), scope: {}, config_snapshot: {}, progress: {} }).returning("id").executeTakeFirstOrThrow();
    const run = await repository.createRun({ bookId, createdBy: owner.id, templateVersionId: template.currentVersionId, jobId: job.id, mode: "balanced", startChapter: 1, endChapter: 1, status: "queued", executionSignature: "7".repeat(64), totalParts: 1 });
    const part = await repository.createPart({ runId: run.id, position: 0, kind: "chapter", status: "running", inputSignature: "8".repeat(64) });
    await repository.completePart({ partId: part.id, actor: owner, result: { valid: true } });
    const malformed = cipher.encrypt("1e400");
    await postgres.db.updateTable("analysis_parts").set({ result_ciphertext: malformed.ciphertext, result_nonce: malformed.nonce, result_tag: malformed.tag, result_key_version: malformed.keyVersion }).where("id", "=", part.id).execute();

    await expect(repository.findReusablePart({ runId: run.id, position: 0, kind: "chapter", inputSignature: "8".repeat(64), actor: owner })).rejects.toThrow(z.ZodError);

    await postgres.db.updateTable("analysis_runs").set({ status: "completed", result_ciphertext: malformed.ciphertext, result_nonce: malformed.nonce, result_tag: malformed.tag, result_key_version: malformed.keyVersion }).where("id", "=", run.id).execute();
    await expect(repository.getRunResult({ runId: run.id, actor: owner })).rejects.toThrow(z.ZodError);

    const prompt = cipher.encrypt("prompt");
    const rawTemplate = await postgres.db.insertInto("analysis_templates").values({ book_id: bookId, created_by: owner.id, name: "Malformed schema", current_version_id: null, index_group_id: null }).returning("id").executeTakeFirstOrThrow();
    const rawVersion = await postgres.db.insertInto("analysis_template_versions").values({ template_id: rawTemplate.id, version: 1, prompt_ciphertext: prompt.ciphertext, prompt_nonce: prompt.nonce, prompt_tag: prompt.tag, prompt_key_version: prompt.keyVersion, schema_ciphertext: malformed.ciphertext, schema_nonce: malformed.nonce, schema_tag: malformed.tag, schema_key_version: malformed.keyVersion, content_hash: "9".repeat(64) }).returning("id").executeTakeFirstOrThrow();
    await postgres.db.updateTable("analysis_templates").set({ current_version_id: rawVersion.id }).where("id", "=", rawTemplate.id).execute();
    await expect(repository.getTemplate({ templateId: rawTemplate.id, actor: owner })).rejects.toThrow(z.ZodError);
  });

  test("validates decrypted typed JSON with Zod", () => {
    const schema = z.strictObject({ count: z.number().int() });
    expect(decryptJson(cipher, encryptJson(cipher, { count: 2 }), schema)).toEqual({ count: 2 });
    expect(() => decryptJson(cipher, encryptJson(cipher, { count: "bad" }), schema)).toThrow(z.ZodError);
  });

  test("encrypts strict execution snapshots and exposes only owner and executor read boundaries", async () => {
    const repository = createAnalysisRepository(postgres.db, cipher);
    const template = await repository.createTemplate({ bookId, createdBy: owner.id, name: "Snapshot", prompt: "SNAPSHOT_PROMPT_SENTINEL", outputSchema: {}, contentHash: "a".repeat(64), indexGroupId: null });
    const job = await postgres.db.insertInto("jobs").values({ type: "advanced-analysis", status: "queued", requested_by: owner.id, request_id: randomUUID(), scope: {}, config_snapshot: {}, progress: {} }).returning("id").executeTakeFirstOrThrow();
    const schema = z.strictObject({ version: z.literal("v1"), factPayload: z.string() });
    const snapshot = { version: "v1" as const, factPayload: "L2_FACT_PAYLOAD_SENTINEL" };
    const run = await repository.createRun({ bookId, createdBy: owner.id, templateVersionId: template.currentVersionId, jobId: job.id, mode: "balanced", startChapter: 1, endChapter: 1, status: "queued", executionSignature: "b".repeat(64), totalParts: 1, executionSnapshot: snapshot, executionSnapshotSchema: schema });
    expect(await repository.getRunExecutionSnapshot({ runId: run.id, actor: owner, schema })).toEqual(snapshot);
    await expect(repository.getRunExecutionSnapshot({ runId: run.id, actor: member, schema })).rejects.toThrow("Analysis access denied");
    await expect(repository.getRunExecutionSnapshot({ runId: run.id, actor: admin, schema })).rejects.toThrow("Analysis access denied");
    expect(await repository.getRunExecutionSnapshotForExecutor({ runId: run.id, schema })).toEqual(snapshot);
    const raw = await postgres.db.selectFrom("analysis_runs").selectAll().where("id", "=", run.id).executeTakeFirstOrThrow();
    expect(raw.execution_snapshot_ciphertext).not.toBeNull(); expect(raw.execution_snapshot_nonce).not.toBeNull(); expect(raw.execution_snapshot_auth_tag).not.toBeNull(); expect(raw.execution_snapshot_key_version).toBe("analysis-v1");
    expect(JSON.stringify(raw)).not.toContain("L2_FACT_PAYLOAD_SENTINEL");
    await expect(repository.createRun({ bookId, createdBy: owner.id, templateVersionId: template.currentVersionId, jobId: job.id, mode: "balanced", startChapter: 1, endChapter: 1, status: "queued", executionSignature: "c".repeat(64), totalParts: 1, executionSnapshot: { ...snapshot, extra: true }, executionSnapshotSchema: schema })).rejects.toThrow(z.ZodError);
  });
});
