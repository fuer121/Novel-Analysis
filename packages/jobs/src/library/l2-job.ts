import { createHash } from "node:crypto";

import type { PublicJob } from "@novel-analysis/contracts";
import {
  L2_ADMISSION_VERSION,
  L2_FACT_SCHEMA_VERSION,
  selectCanonicalL2Freshness,
  type CanonicalVersionSelection,
  type DatabaseConnection,
  type DatabaseExecutor,
} from "@novel-analysis/database";
import { selectL2Scope, type L2ChapterIndexState, type L2ScopeMode } from "@novel-analysis/domain";

import { jobRowToPublic, PUBLIC_JOB_COLUMNS } from "../job-repository.js";

export { L2_ADMISSION_VERSION, L2_FACT_SCHEMA_VERSION };

export class L2BookNotFoundError extends Error {}
export class L2IndexGroupNotFoundError extends Error {}
export class L2ConfigurationError extends Error {}
export class L2ScopeChangedError extends Error {}
export class L2IdempotencyConflictError extends Error {}

export type L2ScopeInput = {
  bookId: string;
  groupId: string;
  startChapter: number;
  endChapter: number;
  mode: L2ScopeMode;
  force: boolean;
  versions?: CanonicalVersionSelection;
};

type ChapterSnapshot = {
  chapterId: string;
  chapterIndex: number;
  chapterTitle: string;
  sourceVersion: string;
  chapterHmac: string;
  l1Signature: string;
  inputSignature: string;
};

type Selection = L2ScopePreview & {
  prompt: { id: string; version: string; content: string; contentHash: string };
  workflow: { id: string; dslHash: string; contractVersion: string; adapterContractVersion: string };
  indexGroup: { id: string; key: string; name: string; categoryScope: "general" | "magical_creature"; configHash: string };
  chapters: ChapterSnapshot[];
};

export type L2ScopePreview = {
  total: number;
  fresh: number;
  missing: number;
  failed: number;
  stale: number;
  executable: number;
  skipped: number;
  scopeHash: string;
};

export type L2Coverage = Pick<L2ScopePreview, "total" | "fresh" | "missing" | "failed" | "stale">;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function storedRequestId(input: L2ScopeInput, requestId: string): string {
  return `l2:${input.bookId}:${input.groupId}:${hash(requestId)}`;
}

function preview(selection: Selection): L2ScopePreview {
  const { total, fresh, missing, failed, stale, executable, skipped, scopeHash } = selection;
  return { total, fresh, missing, failed, stale, executable, skipped, scopeHash };
}

async function selectScope(database: DatabaseExecutor, input: L2ScopeInput): Promise<Selection> {
  const canonical = await selectCanonicalL2Freshness(database, input);
  if (canonical.kind === "book_not_found") throw new L2BookNotFoundError();
  if (canonical.kind === "index_group_not_found") throw new L2IndexGroupNotFoundError();
  if (canonical.kind === "configuration_error") throw new L2ConfigurationError();

  const counts = { fresh: 0, missing: 0, failed: 0, stale: 0 };
  const states: L2ChapterIndexState[] = [];
  const snapshots = new Map<number, ChapterSnapshot>();
  for (const chapter of canonical.chapters) {
    if (chapter.chapterIndex >= input.startChapter && chapter.chapterIndex <= input.endChapter) counts[chapter.state] += 1;
    states.push({ chapterId: chapter.chapterId, chapterIndex: chapter.chapterIndex, status: chapter.state });
    snapshots.set(chapter.chapterIndex, {
      chapterId: chapter.chapterId,
      chapterIndex: chapter.chapterIndex,
      chapterTitle: chapter.chapterTitle,
      sourceVersion: chapter.sourceVersion,
      chapterHmac: chapter.chapterHmac,
      l1Signature: chapter.l1Signature,
      inputSignature: chapter.inputSignature,
    });
  }
  const selected = selectL2Scope({ ...input, chapters: states });
  const chapters = selected.execute.map((chapterIndex) => snapshots.get(chapterIndex)!);
  const scopeHash = hash({
    bookId: input.bookId,
    groupId: input.groupId,
    startChapter: input.startChapter,
    endChapter: input.endChapter,
    mode: input.mode,
    force: input.force,
    prompt: { id: canonical.prompt.id, contentHash: canonical.prompt.contentHash },
    workflow: { id: canonical.workflow.id, dslHash: canonical.workflow.dslHash, adapterContractVersion: canonical.workflow.adapterContractVersion },
    schemaVersion: L2_FACT_SCHEMA_VERSION,
    admissionVersion: L2_ADMISSION_VERSION,
    indexGroupConfigHash: canonical.indexGroup.configHash,
    indexGroupCategoryScope: canonical.indexGroup.categoryScope,
    states: states.filter(({ chapterIndex }) => chapterIndex >= input.startChapter && chapterIndex <= input.endChapter)
      .map((state) => ({ chapterId: state.chapterId, chapterIndex: state.chapterIndex, status: state.status, inputSignature: snapshots.get(state.chapterIndex)!.inputSignature })),
  });
  const total = states.filter(({ chapterIndex }) => chapterIndex >= input.startChapter && chapterIndex <= input.endChapter).length;
  return {
    total,
    ...counts,
    executable: chapters.length,
    skipped: total - chapters.length,
    scopeHash,
    prompt: canonical.prompt,
    workflow: canonical.workflow,
    indexGroup: canonical.indexGroup,
    chapters,
  };
}

function replayMatches(row: { type: string; scope: Record<string, unknown>; config_snapshot: Record<string, unknown> }, input: L2ScopeInput & { scopeHash: string }): boolean {
  return row.type === "l2-index" && row.scope.bookId === input.bookId
    && Array.isArray(row.scope.indexGroupKeys) && row.scope.indexGroupKeys.length === 1 && row.scope.indexGroupKeys[0] === input.groupId
    && row.scope.startChapter === input.startChapter && row.scope.endChapter === input.endChapter && row.scope.mode === input.mode
    && row.config_snapshot.force === input.force && row.config_snapshot.scopeHash === input.scopeHash;
}

export async function createL2Job(database: DatabaseExecutor, input: L2ScopeInput & { requestedBy: string; requestId: string; scopeHash: string }): Promise<PublicJob> {
  const locked = await database.selectFrom("index_groups").select("id").where("id", "=", input.groupId).where("book_id", "=", input.bookId).forUpdate().executeTakeFirst();
  if (!locked) throw new L2IndexGroupNotFoundError();
  const requestId = storedRequestId(input, input.requestId);
  const replay = await database.selectFrom("jobs").select([...PUBLIC_JOB_COLUMNS, "config_snapshot"])
    .where("requested_by", "=", input.requestedBy).where("request_id", "=", requestId).executeTakeFirst();
  if (replay) {
    if (!replayMatches(replay, input)) throw new L2IdempotencyConflictError();
    return jobRowToPublic(replay);
  }

  const selection = await selectScope(database, input);
  if (selection.scopeHash !== input.scopeHash) throw new L2ScopeChangedError();
  const executionSignature = hash({ scopeHash: selection.scopeHash, force: input.force });
  const concurrencyKey = `l2:${input.bookId}:${input.groupId}:${input.startChapter}-${input.endChapter}:${input.mode}:${executionSignature}`;
  const active = await database.selectFrom("jobs").select(PUBLIC_JOB_COLUMNS)
    .where("concurrency_key", "=", concurrencyKey).where("status", "in", ["queued", "running", "retrying", "paused"]).executeTakeFirst();
  if (active) return jobRowToPublic(active);

  const inserted = await database.insertInto("jobs").values({
    type: "l2-index",
    status: selection.executable === 0 ? "completed" : "queued",
    requested_by: input.requestedBy,
    request_id: requestId,
    scope: { bookId: input.bookId, startChapter: input.startChapter, endChapter: input.endChapter, indexGroupKeys: [input.groupId], mode: input.mode },
    config_snapshot: { scopeHash: selection.scopeHash, force: input.force, prompt: selection.prompt, workflow: selection.workflow, schemaVersion: L2_FACT_SCHEMA_VERSION, admissionVersion: L2_ADMISSION_VERSION, indexGroup: selection.indexGroup, chapters: selection.chapters },
    concurrency_key: selection.executable === 0 ? null : concurrencyKey,
    progress: { total: selection.executable, completed: 0, failed: 0, skipped: 0, current: "" },
  }).returning(PUBLIC_JOB_COLUMNS).executeTakeFirstOrThrow();
  const job = jobRowToPublic(inserted);
  if (selection.chapters.length > 0) {
    await database.insertInto("job_steps").values(selection.chapters.map((chapter) => ({ job_id: job.id, position: chapter.chapterIndex, kind: "l2-index", status: "queued" as const, input_signature: chapter.inputSignature, idempotency_key: `${job.id}:l2:${input.groupId}:${chapter.chapterId}`, output_ref: null, lease_owner: null, lease_expires_at: null }))).execute();
  }
  await database.insertInto("job_events").values({ job_id: job.id, type: "created", dedupe_key: "created", payload: { status: job.status } }).execute();
  if (selection.executable > 0) await database.insertInto("job_outbox").values({ job_id: job.id, topic: "jobs.wake", payload: { jobId: job.id }, claimed_by: null, claim_expires_at: null, delivered_at: null }).execute();
  return job;
}

export class L2JobService {
  constructor(private readonly database: DatabaseConnection) {}

  async coverage(input: { bookId: string; groupId: string }): Promise<L2Coverage> {
    const selection = await selectScope(this.database, { ...input, startChapter: 1, endChapter: Number.MAX_SAFE_INTEGER, mode: "all", force: false });
    return { total: selection.total, fresh: selection.fresh, missing: selection.missing, failed: selection.failed, stale: selection.stale };
  }

  async preview(input: L2ScopeInput): Promise<L2ScopePreview> {
    return previewL2Job(this.database, input);
  }

  async create(input: L2ScopeInput & { requestedBy: string; requestId: string; scopeHash: string }): Promise<PublicJob> {
    return this.database.transaction().execute((transaction) => createL2Job(transaction, input));
  }
}

export async function previewL2Job(
  database: DatabaseExecutor,
  input: L2ScopeInput,
): Promise<L2ScopePreview> {
  return preview(await selectScope(database, input));
}
