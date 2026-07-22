import { createHash } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { z } from "zod";

import { AdvancedAnalysisExecutionConfigSchema, AdvancedAnalysisExecutionSnapshotSchema, type AdvancedAnalysisExecutionConfig, type AdvancedAnalysisExecutionSnapshot } from "@novel-analysis/contracts";
import { createAnalysisRepository, decryptJson, encryptJson, type ContentCipher, type Database, type DatabaseConnection } from "@novel-analysis/database";
import { DifyAdapterError, type DifyAdapter } from "@novel-analysis/dify";
import type { ClaimedStep, CompletionDisposition } from "@novel-analysis/jobs";

import { selectAnalysisSources, type SelectedAnalysisSources } from "./analysis-source-selector.js";

const JsonSchema = z.json();
const HIERARCHICAL_BATCH_SIZE = 20;
type ExecutionResult = { disposition: CompletionDisposition | "failed" };
type CompletedCheckpoint = { position: number; kind: string; inputSignature: string; result: unknown };

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function expectedPartSignature(snapshot: AdvancedAnalysisExecutionSnapshot, chapter: AdvancedAnalysisExecutionSnapshot["chapters"][number]): string {
  return hash({ scopeHash: snapshot.scopeHash, chapterId: chapter.id, chapterIndex: chapter.position, contentHmac: chapter.contentHmac, sourceVersion: chapter.sourceVersion });
}

export function checkpointPositions(snapshot: AdvancedAnalysisExecutionSnapshot): { hierarchical: number[]; final: number } {
  const count = Math.ceil(snapshot.chapters.length / HIERARCHICAL_BATCH_SIZE);
  const allocated = allocateCheckpointPositions(snapshot.chapters.map((chapter) => chapter.position), count + 1);
  return { hierarchical: allocated.slice(0, count), final: allocated[count]! };
}

export function allocateCheckpointPositions(usedPositions: number[], count: number): number[] {
  if (!Number.isSafeInteger(count) || count < 0 || usedPositions.some((position) => !Number.isSafeInteger(position) || position < 0 || position > 2_147_483_647)) throw new Error("invalid checkpoint positions");
  const used = new Set(usedPositions);
  const allocated: number[] = [];
  for (let candidate = 0; allocated.length < count; candidate += 1) {
    if (candidate > 2_147_483_647) throw new Error("no checkpoint positions available");
    if (!used.has(candidate)) {
      allocated.push(candidate);
      used.add(candidate);
    }
  }
  return allocated;
}

export function buildHierarchicalSummaryInput(snapshot: AdvancedAnalysisExecutionSnapshot, children: Array<{ position: number; inputSignature: string; result: unknown }>) {
  const ordered = [...children].sort((left, right) => left.position - right.position);
  const input = {
    scopeHash: snapshot.scopeHash,
    executionConfig: { model: snapshot.executionVersions.model, reasoningEffort: snapshot.executionVersions.reasoningEffort, executorVersion: snapshot.executionVersions.executorVersion },
    children: ordered.map((child) => ({ ...child, resultHash: hash(child.result) })),
  };
  return { input, inputSignature: hash({ kind: "analysis-hierarchical-summary", input }) };
}

export function buildFinalCheckpointInput(snapshot: AdvancedAnalysisExecutionSnapshot, hierarchical: Array<{ position: number; inputSignature: string; result: unknown }>) {
  const ordered = [...hierarchical].sort((left, right) => left.position - right.position);
  const input = {
    scopeHash: snapshot.scopeHash,
    templateContentHash: snapshot.template.contentHash,
    executionConfig: { model: snapshot.executionVersions.model, reasoningEffort: snapshot.executionVersions.reasoningEffort, executorVersion: snapshot.executionVersions.executorVersion },
    hierarchical: ordered.map((checkpoint) => ({ ...checkpoint, resultHash: hash(checkpoint.result) })),
  };
  return { input, inputSignature: hash({ kind: "analysis-final", input }) };
}

async function validateClaim(transaction: Transaction<Database>, claim: ClaimedStep): Promise<CompletionDisposition | null> {
  const job = await transaction.selectFrom("jobs").select("status").where("id", "=", claim.jobId).forUpdate().executeTakeFirst();
  if (!job) return "terminal-noop";
  const step = await transaction.selectFrom("job_steps").selectAll().where("id", "=", claim.stepId).where("job_id", "=", claim.jobId).forUpdate().executeTakeFirst();
  if (!step) return "terminal-noop";
  if (step.status === "completed") return "already-completed";
  if (job.status === "cancelled") return "discarded-cancelled";
  if (job.status === "paused") return "paused-boundary";
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
  return validateFinalValue(value, outputSchema);
}

function validateFinalValue(value: unknown, outputSchema: unknown): unknown {
  if (!nonEmpty(value)) throw new Error("invalid_output_schema");
  try { return z.fromJSONSchema(outputSchema as never).parse(value); } catch { throw new Error("invalid_output_schema"); }
}

export class AnalysisExecutor {
  private readonly executionConfig: AdvancedAnalysisExecutionConfig;

  constructor(private readonly options: { database: DatabaseConnection; cipher: ContentCipher; dify?: DifyAdapter; executionConfig?: unknown; checkpointBarrier?: { afterCheckpointCommitted(kind: "hierarchical" | "final"): Promise<void> } }) {
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
    const chapterParts = await this.executeChapterParts(claim, context.runId, snapshot, template.prompt, sources);
    if ("disposition" in chapterParts) return chapterParts;
    const hierarchical = await this.executeHierarchicalSummary(claim, context.runId, snapshot, template.prompt, chapterParts.checkpoints);
    if ("disposition" in hierarchical) return hierarchical;
    const final = await this.executeFinalCheckpoint(claim, context.runId, snapshot, template, hierarchical.checkpoints);
    if ("disposition" in final) return final;
    const terminalBoundary = await this.boundary(claim, context.runId);
    if (terminalBoundary) return { disposition: terminalBoundary };
    return this.complete(claim, context.runId, snapshot, template.outputSchema, final.checkpoint);
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

  private async reusableCheckpoint(runId: string, position: number, kind: string, inputSignature: string): Promise<CompletedCheckpoint | null> {
    const row = await this.options.database.selectFrom("analysis_parts").selectAll().where("run_id", "=", runId).where("position", "=", position).where("kind", "=", kind).where("input_signature", "=", inputSignature).where("status", "=", "completed").executeTakeFirst();
    if (!row || !row.result_ciphertext || !row.result_nonce || !row.result_tag || !row.result_key_version) return null;
    return { position, kind, inputSignature, result: decryptJson(this.options.cipher, { ciphertext: row.result_ciphertext, nonce: row.result_nonce, tag: row.result_tag, keyVersion: row.result_key_version }, JsonSchema) };
  }

  private async executeChapterParts(
    claim: ClaimedStep,
    runId: string,
    snapshot: AdvancedAnalysisExecutionSnapshot,
    prompt: string,
    sources: SelectedAnalysisSources,
  ): Promise<{ checkpoints: Array<{ position: number; inputSignature: string; result: unknown }> } | ExecutionResult> {
    const checkpoints: Array<{ position: number; inputSignature: string; result: unknown }> = [];
    for (const chapter of snapshot.chapters) {
      const boundary = await this.boundary(claim, runId);
      if (boundary) return { disposition: boundary };
      const inputSignature = expectedPartSignature(snapshot, chapter);
      const reusable = await this.reusablePart(runId, chapter.position, inputSignature);
      if (reusable) {
        checkpoints.push({ position: chapter.position, inputSignature, result: reusable.result });
        continue;
      }
      let result: string;
      try {
        result = (await this.options.dify!.runAnalysisSummary({
          invocationKey: `${runId}:part:${chapter.position}`,
          taskType: "l2_query",
          prompt,
          contextJson: JSON.stringify({ stage: "part", mode: snapshot.mode, position: chapter.position, l1: sources.l1.find((item) => item.position === chapter.position)?.value ?? null, l2: sources.l2.find((item) => item.position === chapter.position)?.value ?? null, chapter: sources.chapters.find((item) => item.position === chapter.position)?.content ?? null }),
        })).text;
      } catch (error) {
        return this.fail(claim, runId, chapter.position, error instanceof DifyAdapterError ? error.code : "provider_invalid_response");
      }
      const committed = await this.commitPart(claim, runId, chapter.position, inputSignature, result);
      if (committed) return { disposition: committed };
      checkpoints.push({ position: chapter.position, inputSignature, result });
    }
    return { checkpoints };
  }

  private async executeHierarchicalSummary(
    claim: ClaimedStep,
    runId: string,
    snapshot: AdvancedAnalysisExecutionSnapshot,
    prompt: string,
    children: Array<{ position: number; inputSignature: string; result: unknown }>,
  ): Promise<{ checkpoints: CompletedCheckpoint[] } | ExecutionResult> {
    const positions = checkpointPositions(snapshot).hierarchical;
    const checkpoints: CompletedCheckpoint[] = [];
    for (let batchIndex = 0; batchIndex < positions.length; batchIndex += 1) {
      const boundary = await this.boundary(claim, runId);
      if (boundary) return { disposition: boundary };
      const position = positions[batchIndex]!;
      const batch = children.slice(batchIndex * HIERARCHICAL_BATCH_SIZE, (batchIndex + 1) * HIERARCHICAL_BATCH_SIZE);
      const built = buildHierarchicalSummaryInput(snapshot, batch);
      let reusable: CompletedCheckpoint | null;
      try { reusable = await this.reusableCheckpoint(runId, position, "analysis-hierarchical-summary", built.inputSignature); } catch { return this.fail(claim, runId, null, "invalid_execution_checkpoint"); }
      if (reusable) {
        if (typeof reusable.result !== "string" || !reusable.result.trim()) return this.fail(claim, runId, null, "invalid_execution_checkpoint");
        checkpoints.push(reusable);
        continue;
      }
      let result: string;
      try {
        result = (await this.options.dify!.runAnalysisSummary({ invocationKey: `${runId}:hierarchical:${batchIndex}`, taskType: "l2_query", prompt, contextJson: JSON.stringify({ stage: "hierarchical", batchIndex, ...built.input }) })).text;
        if (!result.trim()) throw new DifyAdapterError("provider_invalid_response");
      } catch (error) {
        return this.fail(claim, runId, null, error instanceof DifyAdapterError ? error.code : "provider_invalid_response");
      }
      const committed = await this.commitCheckpoint(claim, runId, { position, kind: "analysis-hierarchical-summary", inputSignature: built.inputSignature, result });
      if ("disposition" in committed) return committed;
      if (committed.created) await this.options.checkpointBarrier?.afterCheckpointCommitted("hierarchical");
      checkpoints.push(committed.checkpoint);
    }
    return { checkpoints };
  }

  private async executeFinalCheckpoint(
    claim: ClaimedStep,
    runId: string,
    snapshot: AdvancedAnalysisExecutionSnapshot,
    template: { prompt: string; outputSchema: unknown },
    hierarchical: CompletedCheckpoint[],
  ): Promise<{ checkpoint: CompletedCheckpoint } | ExecutionResult> {
    const boundary = await this.boundary(claim, runId);
    if (boundary) return { disposition: boundary };
    const position = checkpointPositions(snapshot).final;
    const built = buildFinalCheckpointInput(snapshot, hierarchical);
    let reusable: CompletedCheckpoint | null;
    try { reusable = await this.reusableCheckpoint(runId, position, "analysis-final", built.inputSignature); } catch { return this.fail(claim, runId, null, "invalid_execution_checkpoint"); }
    if (reusable) {
      try { reusable.result = validateFinalValue(reusable.result, template.outputSchema); } catch { return this.fail(claim, runId, null, "invalid_execution_checkpoint"); }
      return { checkpoint: reusable };
    }
    let result: unknown;
    try {
      const text = (await this.options.dify!.runAnalysisSummary({ invocationKey: `${runId}:final`, taskType: "l2_query", prompt: template.prompt, contextJson: JSON.stringify({ stage: "final", ...built.input }) })).text;
      result = validateFinalAnalysisResult(text, template.outputSchema);
    } catch (error) {
      const code = error instanceof DifyAdapterError ? error.code : error instanceof Error && error.message === "invalid_output_schema" ? "invalid_output_schema" : "provider_invalid_response";
      return this.fail(claim, runId, null, code);
    }
    const committed = await this.commitCheckpoint(claim, runId, { position, kind: "analysis-final", inputSignature: built.inputSignature, result });
    if ("disposition" in committed) return committed;
    if (committed.created) await this.options.checkpointBarrier?.afterCheckpointCommitted("final");
    return { checkpoint: committed.checkpoint };
  }

  private commitCheckpoint(claim: ClaimedStep, runId: string, checkpoint: CompletedCheckpoint): Promise<{ checkpoint: CompletedCheckpoint; created: boolean } | ExecutionResult> {
    return this.options.database.transaction().execute(async (transaction) => {
      const invalid = await validateClaim(transaction, claim);
      if (invalid) return { disposition: invalid };
      const existing = await transaction.selectFrom("analysis_parts").selectAll().where("run_id", "=", runId).where("position", "=", checkpoint.position).forUpdate().executeTakeFirst();
      if (existing?.status === "completed") {
        if (existing.kind !== checkpoint.kind || existing.input_signature !== checkpoint.inputSignature || !existing.result_ciphertext || !existing.result_nonce || !existing.result_tag || !existing.result_key_version) return { disposition: "terminal-noop" };
        return { checkpoint: { ...checkpoint, result: decryptJson(this.options.cipher, { ciphertext: existing.result_ciphertext, nonce: existing.result_nonce, tag: existing.result_tag, keyVersion: existing.result_key_version }, JsonSchema) }, created: false };
      }
      if (existing && (existing.kind !== checkpoint.kind || existing.input_signature !== checkpoint.inputSignature || existing.status === "cancelled")) return { disposition: "terminal-noop" };
      const encrypted = encryptJson(this.options.cipher, checkpoint.result);
      if (existing) {
        await transaction.updateTable("analysis_parts").set({ status: "completed", result_ciphertext: encrypted.ciphertext, result_nonce: encrypted.nonce, result_tag: encrypted.tag, result_key_version: encrypted.keyVersion, error_code: null, output_ref: null, updated_at: new Date() }).where("id", "=", existing.id).execute();
      } else {
        await transaction.insertInto("analysis_parts").values({ run_id: runId, position: checkpoint.position, kind: checkpoint.kind, status: "completed", input_signature: checkpoint.inputSignature, result_ciphertext: encrypted.ciphertext, result_nonce: encrypted.nonce, result_tag: encrypted.tag, result_key_version: encrypted.keyVersion, error_code: null, output_ref: null }).execute();
      }
      return { checkpoint, created: true };
    });
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
      const count = Number((await transaction.selectFrom("analysis_parts").select(({ fn }) => fn.count("id").as("count")).where("run_id", "=", runId).where("kind", "=", "analysis-part").where("status", "=", "completed").executeTakeFirstOrThrow()).count);
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

  private complete(claim: ClaimedStep, runId: string, snapshot: AdvancedAnalysisExecutionSnapshot, outputSchema: unknown, finalCheckpoint: CompletedCheckpoint): Promise<ExecutionResult> {
    return this.options.database.transaction().execute(async (transaction) => {
      const invalid = await validateClaim(transaction, claim);
      if (invalid) return { disposition: invalid };
      for (const chapter of snapshot.chapters) {
        const part = await transaction.selectFrom("analysis_parts").select(["status", "kind", "input_signature"]).where("run_id", "=", runId).where("position", "=", chapter.position).executeTakeFirst();
        if (!part || part.status !== "completed" || part.kind !== "analysis-part" || part.input_signature !== expectedPartSignature(snapshot, chapter)) return { disposition: "terminal-noop" };
      }
      const final = await transaction.selectFrom("analysis_parts").selectAll().where("run_id", "=", runId).where("position", "=", finalCheckpoint.position).where("kind", "=", "analysis-final").where("input_signature", "=", finalCheckpoint.inputSignature).where("status", "=", "completed").forUpdate().executeTakeFirst();
      if (!final?.result_ciphertext || !final.result_nonce || !final.result_tag || !final.result_key_version) return { disposition: "terminal-noop" };
      let result: unknown;
      try { result = validateFinalValue(decryptJson(this.options.cipher, { ciphertext: final.result_ciphertext, nonce: final.result_nonce, tag: final.result_tag, keyVersion: final.result_key_version }, JsonSchema), outputSchema); } catch { return { disposition: "terminal-noop" }; }
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
