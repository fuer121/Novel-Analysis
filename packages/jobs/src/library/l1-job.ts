import { createHash } from "node:crypto";

import type { PublicJob } from "@novel-analysis/contracts";
import {
  L1_ROUTE_SCHEMA_VERSION,
  selectCanonicalL1Freshness,
  type DatabaseConnection,
  type DatabaseExecutor,
} from "@novel-analysis/database";

import { jobRowToPublic, PUBLIC_JOB_COLUMNS } from "../job-repository.js";

export { L1_ROUTE_SCHEMA_VERSION };

export class L1BookNotFoundError extends Error {}
export class L1PromptConfigurationError extends Error {}
export class L1ScopeChangedError extends Error {}
export class L1IdempotencyConflictError extends Error {}

type L1ChapterSnapshot = {
  chapterId: string;
  chapterIndex: number;
  chapterTitle: string;
  sourceVersion: string;
  chapterHmac: string;
  inputSignature: string;
};

type L1Selection = L1ScopePreview & {
  prompt: { id: string; version: string; content: string; contentHash: string };
  workflow: { id: string; dslHash: string; contractVersion: string; adapterContractVersion: string };
  chapters: L1ChapterSnapshot[];
};

export type L1ScopePreview = {
  total: number;
  fresh: number;
  missing: number;
  failed: number;
  stale: number;
  executable: number;
  scopeHash: string;
};

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function requestId(bookId: string, value: string): string {
  return `l1:${bookId}:${createHash("sha256").update(value).digest("hex")}`;
}

async function selectL1Scope(database: DatabaseExecutor, bookId: string): Promise<L1Selection> {
  const canonical = await selectCanonicalL1Freshness(database, bookId);
  if (canonical.kind === "book_not_found") throw new L1BookNotFoundError();
  if (canonical.kind === "configuration_error") throw new L1PromptConfigurationError();

  const counts = { fresh: 0, missing: 0, failed: 0, stale: 0 };
  const chapters: L1ChapterSnapshot[] = [];
  const states: Array<{ chapterId: string; inputSignature: string; state: keyof typeof counts }> = [];
  for (const chapter of canonical.chapters) {
    counts[chapter.state] += 1;
    states.push({ chapterId: chapter.chapterId, inputSignature: chapter.inputSignature, state: chapter.state });
    if (chapter.state !== "fresh") {
      chapters.push({
        chapterId: chapter.chapterId,
        chapterIndex: chapter.chapterIndex,
        chapterTitle: chapter.chapterTitle,
        sourceVersion: chapter.sourceVersion,
        chapterHmac: chapter.chapterHmac,
        inputSignature: chapter.inputSignature,
      });
    }
  }
  const scopeHash = hash({
    bookId,
    prompt: { id: canonical.prompt.id, contentHash: canonical.prompt.contentHash },
    workflow: { id: canonical.workflow.id, dslHash: canonical.workflow.dslHash, adapterContractVersion: canonical.workflow.adapterContractVersion },
    schemaVersion: L1_ROUTE_SCHEMA_VERSION,
    states,
  });
  return {
    total: canonical.chapters.length,
    ...counts,
    executable: chapters.length,
    scopeHash,
    prompt: canonical.prompt,
    workflow: canonical.workflow,
    chapters,
  };
}

function preview(selection: L1Selection): L1ScopePreview {
  return { total: selection.total, fresh: selection.fresh, missing: selection.missing, failed: selection.failed, stale: selection.stale, executable: selection.executable, scopeHash: selection.scopeHash };
}

type StoredL1Job = {
  type: string;
  status: string;
  request_id: string;
  scope: Record<string, unknown>;
  config_snapshot: Record<string, unknown>;
  concurrency_key: string | null;
  progress: Record<string, unknown>;
};

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function hasFrozenSnapshot(value: Record<string, unknown>): boolean {
  const prompt = value.prompt as Record<string, unknown> | undefined;
  const workflow = value.workflow as Record<string, unknown> | undefined;
  if (!prompt || !workflow || !Array.isArray(value.chapters)
    || !hasExactKeys(prompt, ["id", "version", "content", "contentHash"])
    || !hasExactKeys(workflow, ["id", "dslHash", "contractVersion", "adapterContractVersion"])
    || typeof value.scopeHash !== "string" || !/^[a-f0-9]{64}$/.test(value.scopeHash)
    || typeof prompt.id !== "string" || typeof prompt.version !== "string" || typeof prompt.content !== "string" || !prompt.content.trim()
    || typeof prompt.contentHash !== "string" || createHash("sha256").update(prompt.content).digest("hex") !== prompt.contentHash
    || typeof workflow.id !== "string" || typeof workflow.dslHash !== "string" || typeof workflow.contractVersion !== "string"
    || workflow.adapterContractVersion !== workflow.contractVersion || value.schemaVersion !== L1_ROUTE_SCHEMA_VERSION) return false;
  return value.chapters.every((chapter) => {
    if (!chapter || typeof chapter !== "object" || Array.isArray(chapter)) return false;
    const row = chapter as Record<string, unknown>;
    return hasExactKeys(row, ["chapterId", "chapterIndex", "chapterTitle", "sourceVersion", "chapterHmac", "inputSignature"])
      && typeof row.chapterId === "string" && typeof row.chapterIndex === "number" && typeof row.chapterTitle === "string"
      && typeof row.sourceVersion === "string" && typeof row.chapterHmac === "string" && typeof row.inputSignature === "string";
  });
}

function replayMatches(row: StoredL1Job, input: { bookId: string; scopeHash?: string; handoffFromImportJobId?: string }): boolean {
  if (row.type !== "l1-index" || row.scope.bookId !== input.bookId || !hasFrozenSnapshot(row.config_snapshot)) return false;
  if (input.handoffFromImportJobId !== undefined) return row.config_snapshot.handoffFromImportJobId === input.handoffFromImportJobId && typeof row.config_snapshot.scopeHash === "string";
  return row.config_snapshot.handoffFromImportJobId === undefined && row.config_snapshot.scopeHash === input.scopeHash;
}

function isLegacyHandoff(row: StoredL1Job, input: { bookId: string; requestId: string; handoffFromImportJobId?: string }): boolean {
  return input.handoffFromImportJobId !== undefined
    && row.type === "l1-index" && row.status === "queued" && row.request_id === input.requestId
    && Object.keys(row.scope).length === 1 && row.scope.bookId === input.bookId && row.concurrency_key === `l1:${input.bookId}`
    && Object.keys(row.config_snapshot).length === 1 && row.config_snapshot.handoffFromImportJobId === input.handoffFromImportJobId
    && Number(row.progress.total ?? -1) === 0 && Number(row.progress.completed ?? -1) === 0
    && Number(row.progress.failed ?? -1) === 0 && Number(row.progress.skipped ?? -1) === 0 && row.progress.current === "";
}

async function createL1JobInTransaction(database: DatabaseExecutor, input: {
  bookId: string;
  requestedBy: string;
  requestId: string;
  scopeHash?: string;
  handoffFromImportJobId?: string;
}): Promise<PublicJob> {
  const locked = await database.selectFrom("books").select("id").where("id", "=", input.bookId).forUpdate().executeTakeFirst();
  if (!locked) throw new L1BookNotFoundError();
  const storedRequestId = requestId(input.bookId, input.requestId);
  const existing = await database.selectFrom("jobs").select([...PUBLIC_JOB_COLUMNS, "request_id", "config_snapshot", "concurrency_key"])
    .where("requested_by", "=", input.requestedBy).where("request_id", "=", storedRequestId).executeTakeFirst();
  if (existing) {
    if (!replayMatches(existing, input)) throw new L1IdempotencyConflictError();
    return jobRowToPublic(existing);
  }
  const legacy = input.handoffFromImportJobId === undefined ? undefined : await database.selectFrom("jobs")
    .select([...PUBLIC_JOB_COLUMNS, "request_id", "config_snapshot", "concurrency_key"])
    .where("requested_by", "=", input.requestedBy).where("request_id", "=", input.requestId).forUpdate().executeTakeFirst();
  if (legacy && replayMatches(legacy, input)) return jobRowToPublic(legacy);
  if (legacy && !isLegacyHandoff(legacy, input)) throw new L1IdempotencyConflictError();
  if (legacy) {
    const [stepCount, outboxCount] = await Promise.all([
      database.selectFrom("job_steps").select(({ fn }) => fn.countAll<number>().as("count")).where("job_id", "=", legacy.id).executeTakeFirstOrThrow(),
      database.selectFrom("job_outbox").select(({ fn }) => fn.countAll<number>().as("count")).where("job_id", "=", legacy.id).executeTakeFirstOrThrow(),
    ]);
    if (Number(stepCount.count) !== 0 || Number(outboxCount.count) !== 0) throw new L1IdempotencyConflictError();
  }
  const selection = await selectL1Scope(database, input.bookId);
  if (input.scopeHash !== undefined && selection.scopeHash !== input.scopeHash) throw new L1ScopeChangedError();
  if (legacy) {
    const configSnapshot = { scopeHash: selection.scopeHash, prompt: selection.prompt, workflow: selection.workflow, schemaVersion: L1_ROUTE_SCHEMA_VERSION, chapters: selection.chapters, handoffFromImportJobId: input.handoffFromImportJobId! };
    const expanded = await database.updateTable("jobs").set({
      status: selection.executable === 0 ? "completed" : "queued",
      config_snapshot: configSnapshot,
      concurrency_key: selection.executable === 0 ? null : `l1:${input.bookId}`,
      progress: { total: selection.executable, completed: 0, failed: 0, skipped: 0, current: "" },
      updated_at: new Date(),
    }).where("id", "=", legacy.id).returning(PUBLIC_JOB_COLUMNS).executeTakeFirstOrThrow();
    if (selection.chapters.length > 0) {
      await database.insertInto("job_steps").values(selection.chapters.map((chapter) => ({ job_id: legacy.id, position: chapter.chapterIndex, kind: "l1-index" as const, status: "queued" as const, input_signature: chapter.inputSignature, idempotency_key: `${legacy.id}:l1:${chapter.chapterId}`, output_ref: null, lease_owner: null, lease_expires_at: null }))).execute();
      await database.insertInto("job_outbox").values({ job_id: legacy.id, topic: "jobs.wake", payload: { jobId: legacy.id }, claimed_by: null, claim_expires_at: null, delivered_at: null }).execute();
    }
    return jobRowToPublic(expanded);
  }
  const active = await database.selectFrom("jobs").select([...PUBLIC_JOB_COLUMNS, "config_snapshot"])
    .where("concurrency_key", "=", `l1:${input.bookId}`).where("status", "in", ["queued", "running", "retrying", "paused"]).executeTakeFirst();
  if (active) {
    if (active.config_snapshot.scopeHash !== selection.scopeHash) throw new L1IdempotencyConflictError();
    return jobRowToPublic(active);
  }
  const inserted = await database.insertInto("jobs").values({
    type: "l1-index",
    status: selection.executable === 0 ? "completed" : "queued",
    requested_by: input.requestedBy,
    request_id: storedRequestId,
    scope: { bookId: input.bookId },
    config_snapshot: {
      scopeHash: selection.scopeHash,
      prompt: selection.prompt,
      workflow: selection.workflow,
      schemaVersion: L1_ROUTE_SCHEMA_VERSION,
      chapters: selection.chapters,
      ...(input.handoffFromImportJobId ? { handoffFromImportJobId: input.handoffFromImportJobId } : {}),
    },
    concurrency_key: selection.executable === 0 ? null : `l1:${input.bookId}`,
    progress: { total: selection.executable, completed: 0, failed: 0, skipped: 0, current: "" },
  }).returning(PUBLIC_JOB_COLUMNS).executeTakeFirstOrThrow();
  const job = jobRowToPublic(inserted);
  if (selection.chapters.length > 0) {
    await database.insertInto("job_steps").values(selection.chapters.map((chapter) => ({
      job_id: job.id,
      position: chapter.chapterIndex,
      kind: "l1-index",
      status: "queued" as const,
      input_signature: chapter.inputSignature,
      idempotency_key: `${job.id}:l1:${chapter.chapterId}`,
      output_ref: null,
      lease_owner: null,
      lease_expires_at: null,
    }))).execute();
  }
  await database.insertInto("job_events").values({ job_id: job.id, type: "created", dedupe_key: "created", payload: { status: job.status } }).execute();
  if (selection.executable > 0) await database.insertInto("job_outbox").values({ job_id: job.id, topic: "jobs.wake", payload: { jobId: job.id }, claimed_by: null, claim_expires_at: null, delivered_at: null }).execute();
  return job;
}

export async function createImportL1Job(database: DatabaseExecutor, input: { importJobId: string; bookId: string; requestedBy: string }): Promise<PublicJob> {
  return createL1JobInTransaction(database, { ...input, requestId: `import-handoff:${input.importJobId}`, handoffFromImportJobId: input.importJobId });
}

export class L1JobService {
  constructor(private readonly database: DatabaseConnection) {}

  async preview(input: { bookId: string }): Promise<L1ScopePreview> {
    return preview(await selectL1Scope(this.database, input.bookId));
  }

  async create(input: { bookId: string; requestedBy: string; requestId: string; scopeHash: string }): Promise<PublicJob> {
    return this.database.transaction().execute((transaction) => createL1JobInTransaction(transaction, input));
  }
}
