import { createHash } from "node:crypto";

import type { PublicJob } from "@novel-analysis/contracts";
import type { DatabaseConnection, DatabaseExecutor } from "@novel-analysis/database";
import { buildL2Signature, selectL2Scope, type L2ChapterIndexState, type L2ScopeMode } from "@novel-analysis/domain";

import { jobRowToPublic, PUBLIC_JOB_COLUMNS } from "../job-repository.js";

export const L2_FACT_SCHEMA_VERSION = "l2-facts-v1";
export const L2_ADMISSION_VERSION = "l2-admission-v1";

export class L2BookNotFoundError extends Error {}
export class L2IndexGroupNotFoundError extends Error {}
export class L2ConfigurationError extends Error {}
export class L2ScopeChangedError extends Error {}
export class L2IdempotencyConflictError extends Error {}

type ScopeInput = {
  bookId: string;
  groupId: string;
  startChapter: number;
  endChapter: number;
  mode: L2ScopeMode;
  force: boolean;
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

function storedRequestId(input: ScopeInput, requestId: string): string {
  return `l2:${input.bookId}:${input.groupId}:${hash(requestId)}`;
}

function preview(selection: Selection): L2ScopePreview {
  const { total, fresh, missing, failed, stale, executable, skipped, scopeHash } = selection;
  return { total, fresh, missing, failed, stale, executable, skipped, scopeHash };
}

async function selectScope(database: DatabaseExecutor, input: ScopeInput): Promise<Selection> {
  const book = await database.selectFrom("books").select("id").where("id", "=", input.bookId).where("status", "=", "active").executeTakeFirst();
  if (!book) throw new L2BookNotFoundError();
  const group = await database.selectFrom("index_groups as g")
    .innerJoin("prompt_versions as p", "p.id", "g.prompt_version_id")
    .select(["g.id", "g.key", "g.name", "g.category_scope", "g.config_hash", "p.id as prompt_id", "p.version as prompt_version", "p.content as prompt_content", "p.content_hash as prompt_hash"])
    .where("g.id", "=", input.groupId).where("g.book_id", "=", input.bookId).where("g.status", "=", "active").where("p.target", "=", "l2-index").executeTakeFirst();
  if (!group) throw new L2IndexGroupNotFoundError();
  const workflow = await database.selectFrom("workflow_versions").selectAll().where("target", "=", "l2-index").where("enabled", "=", true).orderBy("created_at", "desc").orderBy("id", "desc").executeTakeFirst();
  if (!workflow || !group.prompt_content.trim()
    || createHash("sha256").update(group.prompt_content).digest("hex") !== group.prompt_hash) throw new L2ConfigurationError();

  const rows = await database.selectFrom("chapters as c")
    .leftJoin("l1_indexes as l", (join) => join.onRef("l.chapter_id", "=", "c.id").on("l.is_current", "=", true))
    .leftJoin("l2_chapter_statuses as s", (join) => join.onRef("s.chapter_id", "=", "c.id").on("s.group_id", "=", input.groupId))
    .select(["c.id", "c.chapter_index", "c.title", "c.source_version", "c.content_hmac", "l.input_signature as l1_signature", "s.input_signature", "s.status"])
    .where("c.book_id", "=", input.bookId).orderBy("c.chapter_index").execute();

  const counts = { fresh: 0, missing: 0, failed: 0, stale: 0 };
  const states: L2ChapterIndexState[] = [];
  const snapshots = new Map<number, ChapterSnapshot>();
  for (const row of rows) {
    const l1Signature = row.l1_signature ?? "";
    const inputSignature = buildL2Signature({
      sourceVersion: row.source_version,
      chapterHmac: row.content_hmac,
      promptHash: group.prompt_hash,
      workflowDslHash: workflow.dsl_hash,
      adapterContractVersion: workflow.contract_version,
      schemaVersion: L2_FACT_SCHEMA_VERSION,
      admissionVersion: L2_ADMISSION_VERSION,
      indexGroupConfigHash: group.config_hash,
      l1Signature,
    });
    const status = row.input_signature === null
      ? "missing"
      : row.input_signature !== inputSignature || row.status === "stale"
        ? "stale"
        : row.status === "failed" ? "failed" : "fresh";
    if (row.chapter_index >= input.startChapter && row.chapter_index <= input.endChapter) counts[status] += 1;
    states.push({ chapterId: row.id, chapterIndex: row.chapter_index, status });
    snapshots.set(row.chapter_index, { chapterId: row.id, chapterIndex: row.chapter_index, chapterTitle: row.title, sourceVersion: row.source_version, chapterHmac: row.content_hmac, l1Signature, inputSignature });
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
    prompt: { id: group.prompt_id, contentHash: group.prompt_hash },
    workflow: { id: workflow.id, dslHash: workflow.dsl_hash, adapterContractVersion: workflow.contract_version },
    schemaVersion: L2_FACT_SCHEMA_VERSION,
    admissionVersion: L2_ADMISSION_VERSION,
    indexGroupConfigHash: group.config_hash,
    indexGroupCategoryScope: group.category_scope,
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
    prompt: { id: group.prompt_id, version: group.prompt_version, content: group.prompt_content, contentHash: group.prompt_hash },
    workflow: { id: workflow.id, dslHash: workflow.dsl_hash, contractVersion: workflow.contract_version, adapterContractVersion: workflow.contract_version },
    indexGroup: { id: group.id, key: group.key, name: group.name, categoryScope: group.category_scope, configHash: group.config_hash },
    chapters,
  };
}

function replayMatches(row: { type: string; scope: Record<string, unknown>; config_snapshot: Record<string, unknown> }, input: ScopeInput & { scopeHash: string }): boolean {
  return row.type === "l2-index" && row.scope.bookId === input.bookId
    && Array.isArray(row.scope.indexGroupKeys) && row.scope.indexGroupKeys.length === 1 && row.scope.indexGroupKeys[0] === input.groupId
    && row.scope.startChapter === input.startChapter && row.scope.endChapter === input.endChapter && row.scope.mode === input.mode
    && row.config_snapshot.force === input.force && row.config_snapshot.scopeHash === input.scopeHash;
}

async function createInTransaction(database: DatabaseExecutor, input: ScopeInput & { requestedBy: string; requestId: string; scopeHash: string }): Promise<PublicJob> {
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

  async preview(input: ScopeInput): Promise<L2ScopePreview> {
    return preview(await selectScope(this.database, input));
  }

  async create(input: ScopeInput & { requestedBy: string; requestId: string; scopeHash: string }): Promise<PublicJob> {
    return this.database.transaction().execute((transaction) => createInTransaction(transaction, input));
  }
}
