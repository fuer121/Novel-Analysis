import { createHash } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { z } from "zod";

import { AdvancedAnalysisExecutionConfigSchema, AdvancedAnalysisExecutionSnapshotSchema, type AdvancedAnalysisExecutionConfig, type AdvancedAnalysisExecutionSnapshot } from "@novel-analysis/contracts";
import { createAnalysisRepository, decryptJson, encryptJson, type ContentCipher, type Database, type DatabaseConnection } from "@novel-analysis/database";
import { DifyAdapterError, type DifyAdapter } from "@novel-analysis/dify";
import type { ClaimedStep, CompletionDisposition } from "@novel-analysis/jobs";

import { selectAnalysisSources, type SelectedAnalysisSources } from "./analysis-source-selector.js";

const JsonSchema = z.json();
type ExecutionResult = { disposition: CompletionDisposition | "failed" };

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function expectedPartSignature(snapshot: AdvancedAnalysisExecutionSnapshot, chapter: AdvancedAnalysisExecutionSnapshot["chapters"][number]): string {
  return hash({ scopeHash: snapshot.scopeHash, chapterId: chapter.id, chapterIndex: chapter.position, contentHmac: chapter.contentHmac, sourceVersion: chapter.sourceVersion });
}

async function validateClaim(transaction: Transaction<Database>, claim: ClaimedStep): Promise<CompletionDisposition | null> {
  const job = await transaction.selectFrom("jobs").select("status").where("id", "=", claim.jobId).forUpdate().executeTakeFirst();
  if (!job) return "terminal-noop";
  const step = await transaction.selectFrom("job_steps").selectAll().where("id", "=", claim.stepId).where("job_id", "=", claim.jobId).forUpdate().executeTakeFirst();
  if (!step) return "terminal-noop";
  if (step.status === "completed") return "already-completed";
  if (job.status === "cancelled") return "discarded-cancelled";
  if (["completed", "failed"].includes(job.status)) return "terminal-noop";
  const now = (await sql<{ now: Date }>`select clock_timestamp() as now`.execute(transaction)).rows[0]!.now;
  if (step.status !== "running" || step.lease_owner !== claim.workerId || step.attempt_count !== claim.attemptNo
    || step.lease_expires_at?.getTime() !== claim.leaseExpiresAt.getTime() || step.lease_expires_at.getTime() <= now.getTime()) return "terminal-noop";
  const attempt = await transaction.selectFrom("job_attempts").selectAll().where("id", "=", claim.attemptId).forUpdate().executeTakeFirst();
  if (!attempt || attempt.step_id !== claim.stepId || attempt.attempt_no !== claim.attemptNo || attempt.worker_id !== claim.workerId || attempt.status !== "running") return "terminal-noop";
  return null;
}

function nonEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

export function validateFinalAnalysisResult(text: string, outputSchema: unknown): unknown {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("invalid_output_schema"); }
  if (!nonEmpty(value)) throw new Error("invalid_output_schema");
  try { return z.fromJSONSchema(outputSchema as never).parse(value); } catch { throw new Error("invalid_output_schema"); }
}

export class AnalysisExecutor {
  private readonly executionConfig: AdvancedAnalysisExecutionConfig;

  constructor(private readonly options: { database: DatabaseConnection; cipher: ContentCipher; dify?: DifyAdapter; executionConfig?: unknown }) {
    this.executionConfig = AdvancedAnalysisExecutionConfigSchema.parse(options.executionConfig);
  }

  async execute(claim: ClaimedStep): Promise<ExecutionResult> {
    if (claim.kind !== "advanced-analysis") throw new Error("AnalysisExecutor only accepts advanced-analysis steps");
    const context = await this.loadContext(claim);
    let snapshot: AdvancedAnalysisExecutionSnapshot;
    try {
      const parsed = await createAnalysisRepository(this.options.database, this.options.cipher).getRunExecutionSnapshotForExecutor({ runId: context.runId, schema: AdvancedAnalysisExecutionSnapshotSchema });
      if (!parsed) return this.fail(claim, context.runId, null, "invalid_execution_snapshot");
      snapshot = parsed;
    } catch {
      return this.fail(claim, context.runId, null, "invalid_execution_snapshot");
    }
    if (JSON.stringify(snapshot.executionVersions.model) !== JSON.stringify(this.executionConfig.model)
      || snapshot.executionVersions.reasoningEffort !== this.executionConfig.reasoningEffort
      || snapshot.executionVersions.executorVersion !== this.executionConfig.executorVersion) {
      return this.fail(claim, context.runId, null, "configuration_error");
    }
    const template = await this.loadFrozenTemplate(snapshot);
    if (!template) return this.fail(claim, context.runId, null, "invalid_execution_snapshot");
    if (!this.options.dify) return this.fail(claim, context.runId, null, "configuration_error");

    let sources: SelectedAnalysisSources;
    try {
      sources = await selectAnalysisSources(snapshot, async (chapter) => this.decryptFrozenChapter(snapshot, chapter));
    } catch {
      return this.fail(claim, context.runId, null, "invalid_execution_snapshot");
    }
    const completed: Array<{ position: number; result: unknown }> = [];
    for (const chapter of snapshot.chapters) {
      const boundary = await this.boundary(claim, context.runId);
      if (boundary) return { disposition: boundary };
      const signature = expectedPartSignature(snapshot, chapter);
      const reusable = await this.reusablePart(context.runId, chapter.position, signature);
      if (reusable) {
        completed.push({ position: chapter.position, result: reusable.result });
        continue;
      }
      let output: string;
      try {
        output = (await this.options.dify.runAnalysisSummary({
          invocationKey: `${context.runId}:part:${chapter.position}`,
          taskType: "l2_query",
          prompt: template.prompt,
          contextJson: JSON.stringify({ stage: "part", mode: snapshot.mode, position: chapter.position, l1: sources.l1.find((item) => item.position === chapter.position)?.value ?? null, l2: sources.l2.find((item) => item.position === chapter.position)?.value ?? null, chapter: sources.chapters.find((item) => item.position === chapter.position)?.content ?? null }),
        })).text;
      } catch (error) {
        const code = error instanceof DifyAdapterError ? error.code : "provider_invalid_response";
        return this.fail(claim, context.runId, chapter.position, code);
      }
      const committed = await this.commitPart(claim, context.runId, chapter.position, signature, output);
      if (committed) return { disposition: committed };
      completed.push({ position: chapter.position, result: output });
    }

    const boundary = await this.boundary(claim, context.runId);
    if (boundary) return { disposition: boundary };
    let finalText: string;
    try {
      finalText = (await this.options.dify.runAnalysisSummary({ invocationKey: `${context.runId}:final`, taskType: "l2_query", prompt: template.prompt, contextJson: JSON.stringify({ stage: "final", mode: snapshot.mode, parts: completed }) })).text;
    } catch (error) {
      return this.fail(claim, context.runId, null, error instanceof DifyAdapterError ? error.code : "provider_invalid_response");
    }
    let result: unknown;
    try { result = validateFinalAnalysisResult(finalText, template.outputSchema); } catch { return this.fail(claim, context.runId, null, "invalid_output_schema"); }
    return this.complete(claim, context.runId, snapshot, result);
  }

  private async loadContext(claim: ClaimedStep): Promise<{ runId: string }> {
    const row = await this.options.database.selectFrom("job_steps").select("output_ref").where("id", "=", claim.stepId).where("job_id", "=", claim.jobId).executeTakeFirstOrThrow();
    const runId = row.output_ref?.runId;
    if (typeof runId !== "string") throw new Error("Invalid analysis job configuration");
    return { runId };
  }

  private async loadFrozenTemplate(snapshot: AdvancedAnalysisExecutionSnapshot): Promise<{ prompt: string; outputSchema: unknown } | null> {
    const row = await this.options.database.selectFrom("analysis_template_versions").selectAll().where("id", "=", snapshot.template.versionId).executeTakeFirst();
    if (!row || row.content_hash !== snapshot.template.contentHash) return null;
    try {
      return {
        prompt: this.options.cipher.decrypt({ ciphertext: row.prompt_ciphertext, nonce: row.prompt_nonce, tag: row.prompt_tag, keyVersion: row.prompt_key_version }),
        outputSchema: decryptJson(this.options.cipher, { ciphertext: row.schema_ciphertext, nonce: row.schema_nonce, tag: row.schema_tag, keyVersion: row.schema_key_version }, JsonSchema),
      };
    } catch { return null; }
  }

  private async decryptFrozenChapter(snapshot: AdvancedAnalysisExecutionSnapshot, chapter: AdvancedAnalysisExecutionSnapshot["chapters"][number]): Promise<string> {
    const row = await this.options.database.selectFrom("chapters").selectAll().where("id", "=", chapter.id).where("book_id", "=", snapshot.bookId).executeTakeFirst();
    if (!row || row.chapter_index !== chapter.position || row.content_hmac !== chapter.contentHmac || row.source_version !== chapter.sourceVersion) throw new Error("invalid_execution_snapshot");
    return this.options.cipher.decrypt({ ciphertext: row.content_ciphertext, nonce: row.content_nonce, tag: row.content_tag, keyVersion: row.content_key_version });
  }

  private boundary(claim: ClaimedStep, runId: string): Promise<CompletionDisposition | null> {
    return this.options.database.transaction().execute(async (transaction) => {
      const invalid = await validateClaim(transaction, claim);
      if (invalid) {
        if (invalid === "discarded-cancelled") await transaction.updateTable("analysis_runs").set({ status: "cancelled", updated_at: new Date() }).where("id", "=", runId).where("status", "not in", ["completed", "failed", "cancelled"]).execute();
        return invalid;
      }
      const job = await transaction.selectFrom("jobs").select("status").where("id", "=", claim.jobId).executeTakeFirstOrThrow();
      if (job.status === "paused") {
        await transaction.updateTable("analysis_runs").set({ status: "paused", updated_at: new Date() }).where("id", "=", runId).execute();
        return "paused-boundary";
      }
      await transaction.updateTable("analysis_runs").set({ status: "running", updated_at: new Date() }).where("id", "=", runId).where("status", "in", ["queued", "retrying", "paused"]).execute();
      return null;
    });
  }

  private async reusablePart(runId: string, position: number, inputSignature: string): Promise<{ result: unknown } | null> {
    const row = await this.options.database.selectFrom("analysis_parts").selectAll().where("run_id", "=", runId).where("position", "=", position).where("kind", "=", "analysis-part").where("input_signature", "=", inputSignature).where("status", "=", "completed").executeTakeFirst();
    if (!row || !row.result_ciphertext || !row.result_nonce || !row.result_tag || !row.result_key_version) return null;
    return { result: decryptJson(this.options.cipher, { ciphertext: row.result_ciphertext, nonce: row.result_nonce, tag: row.result_tag, keyVersion: row.result_key_version }, JsonSchema) };
  }

  private commitPart(claim: ClaimedStep, runId: string, position: number, inputSignature: string, result: unknown): Promise<CompletionDisposition | null> {
    return this.options.database.transaction().execute(async (transaction) => {
      const invalid = await validateClaim(transaction, claim);
      if (invalid) {
        if (invalid === "discarded-cancelled") await transaction.updateTable("analysis_runs").set({ status: "cancelled", updated_at: new Date() }).where("id", "=", runId).where("status", "not in", ["completed", "failed", "cancelled"]).execute();
        return invalid;
      }
      const part = await transaction.selectFrom("analysis_parts").selectAll().where("run_id", "=", runId).where("position", "=", position).forUpdate().executeTakeFirst();
      if (!part || part.kind !== "analysis-part" || part.input_signature !== inputSignature || part.status === "completed" || part.status === "cancelled") return "terminal-noop";
      const encrypted = encryptJson(this.options.cipher, result);
      await transaction.updateTable("analysis_parts").set({ status: "completed", result_ciphertext: encrypted.ciphertext, result_nonce: encrypted.nonce, result_tag: encrypted.tag, result_key_version: encrypted.keyVersion, error_code: null, output_ref: null, updated_at: new Date() }).where("id", "=", part.id).execute();
      const count = Number((await transaction.selectFrom("analysis_parts").select(({ fn }) => fn.count("id").as("count")).where("run_id", "=", runId).where("status", "=", "completed").executeTakeFirstOrThrow()).count);
      await transaction.updateTable("analysis_runs").set({ status: "running", completed_parts: count, updated_at: new Date() }).where("id", "=", runId).execute();
      return null;
    });
  }

  private fail(claim: ClaimedStep, runId: string, partPosition: number | null, errorCode: string): Promise<ExecutionResult> {
    return this.options.database.transaction().execute(async (transaction) => {
      const invalid = await validateClaim(transaction, claim);
      if (invalid) return { disposition: invalid };
      if (partPosition !== null) await transaction.updateTable("analysis_parts").set({ status: "failed", error_code: errorCode, updated_at: new Date() }).where("run_id", "=", runId).where("position", "=", partPosition).where("status", "!=", "completed").execute();
      await transaction.updateTable("analysis_runs").set({ status: "failed", error_code: errorCode, updated_at: new Date() }).where("id", "=", runId).execute();
      await transaction.updateTable("job_attempts").set({ status: "failed", error_code: errorCode, error_message: errorCode, finished_at: new Date() }).where("id", "=", claim.attemptId).execute();
      await transaction.updateTable("job_steps").set({ status: "failed", lease_owner: null, lease_expires_at: null, updated_at: new Date() }).where("id", "=", claim.stepId).execute();
      await transaction.updateTable("jobs").set({ status: "failed", updated_at: new Date() }).where("id", "=", claim.jobId).execute();
      await transaction.insertInto("job_events").values({ job_id: claim.jobId, type: "failed", dedupe_key: `step:${claim.stepId}:failed`, payload: { stepId: claim.stepId, position: claim.position, errorCode } }).onConflict((conflict) => conflict.columns(["job_id", "dedupe_key"]).doNothing()).execute();
      return { disposition: "failed" };
    });
  }

  private complete(claim: ClaimedStep, runId: string, snapshot: AdvancedAnalysisExecutionSnapshot, result: unknown): Promise<ExecutionResult> {
    return this.options.database.transaction().execute(async (transaction) => {
      const invalid = await validateClaim(transaction, claim);
      if (invalid) return { disposition: invalid };
      for (const chapter of snapshot.chapters) {
        const part = await transaction.selectFrom("analysis_parts").select(["status", "kind", "input_signature"]).where("run_id", "=", runId).where("position", "=", chapter.position).executeTakeFirst();
        if (!part || part.status !== "completed" || part.kind !== "analysis-part" || part.input_signature !== expectedPartSignature(snapshot, chapter)) return { disposition: "terminal-noop" };
      }
      const encrypted = encryptJson(this.options.cipher, result);
      await transaction.updateTable("analysis_runs").set({ status: "completed", completed_parts: snapshot.chapters.length, result_ciphertext: encrypted.ciphertext, result_nonce: encrypted.nonce, result_tag: encrypted.tag, result_key_version: encrypted.keyVersion, error_code: null, updated_at: new Date() }).where("id", "=", runId).execute();
      await transaction.updateTable("job_steps").set({ status: "completed", output_ref: { runId, status: "completed" }, lease_owner: null, lease_expires_at: null, updated_at: new Date() }).where("id", "=", claim.stepId).execute();
      await transaction.updateTable("job_attempts").set({ status: "completed", finished_at: new Date() }).where("id", "=", claim.attemptId).execute();
      const job = await transaction.selectFrom("jobs").select("progress").where("id", "=", claim.jobId).executeTakeFirstOrThrow();
      const progress = { ...job.progress, completed: snapshot.chapters.length, current: claim.kind };
      await transaction.updateTable("jobs").set({ status: "completed", progress, updated_at: new Date() }).where("id", "=", claim.jobId).execute();
      await transaction.insertInto("job_events").values({ job_id: claim.jobId, type: "progress", dedupe_key: `step:${claim.stepId}:completed`, payload: { stepId: claim.stepId, position: claim.position, progress } }).onConflict((conflict) => conflict.columns(["job_id", "dedupe_key"]).doNothing()).execute();
      await transaction.insertInto("job_events").values({ job_id: claim.jobId, type: "completed", dedupe_key: "completed", payload: { status: "completed", progress } }).onConflict((conflict) => conflict.columns(["job_id", "dedupe_key"]).doNothing()).execute();
      return { disposition: "completed" };
    });
  }
}
