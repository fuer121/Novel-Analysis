import { createHash } from "node:crypto";

import type { PublicJob } from "@novel-analysis/contracts";
import type { DatabaseConnection, DatabaseExecutor } from "@novel-analysis/database";

import { jobRowToPublic, PUBLIC_JOB_COLUMNS } from "../job-repository.js";
import { createImportL1Job } from "./l1-job.js";

export class BookNotFoundError extends Error {}
export class ScopeChangedError extends Error {}
export class IdempotencyConflictError extends Error {}
export class InvalidImportScopeError extends Error {}

export const MAX_IMPORT_CHAPTER_INDEX = 10_000_000;
export const MAX_IMPORT_CHAPTERS = 3_000;

type Source = {
  provider: string;
  sourceId: string;
  startChapter: number;
  endChapter: number;
};

export type ImportScopePreview = {
  requested: number;
  existingFresh: number;
  existingStale: number;
  executable: number;
  scopeHash: string;
};

type Selection = ImportScopePreview & {
  source: Source;
  sourceVersion: string;
  executableIndexes: number[];
};

export function buildImportSourceVersion(source: Source): string {
  return createHash("sha256").update(JSON.stringify(source)).digest("hex");
}

function validateSource(source: Source): void {
  const span = source.endChapter - source.startChapter + 1;
  if (source.provider !== "dify"
    || !Number.isSafeInteger(source.startChapter) || !Number.isSafeInteger(source.endChapter)
    || source.startChapter <= 0 || source.endChapter < source.startChapter
    || source.endChapter > MAX_IMPORT_CHAPTER_INDEX || span > MAX_IMPORT_CHAPTERS) {
    throw new InvalidImportScopeError();
  }
}

function importRequestId(bookId: string, requestId: string): string {
  return `import:${bookId}:${createHash("sha256").update(requestId).digest("hex")}`;
}

function selectionMatches(row: { type: string; scope: Record<string, unknown>; config_snapshot: Record<string, unknown> }, selection: Selection, bookId: string, autoStartL1: boolean): boolean {
  const source = row.config_snapshot.source as Record<string, unknown> | undefined;
  return row.type === "import" && row.scope.bookId === bookId
    && row.scope.startChapter === selection.source.startChapter && row.scope.endChapter === selection.source.endChapter
    && row.config_snapshot.scopeHash === selection.scopeHash
    && row.config_snapshot.sourceVersion === selection.sourceVersion && row.config_snapshot.autoStartL1 === autoStartL1
    && source?.provider === selection.source.provider && source.sourceId === selection.source.sourceId
    && source.startChapter === selection.source.startChapter && source.endChapter === selection.source.endChapter;
}

function replayMatches(row: { type: string; scope: Record<string, unknown>; config_snapshot: Record<string, unknown> }, input: { bookId: string; scopeHash: string; autoStartL1: boolean }): boolean {
  const source = row.config_snapshot.source as Record<string, unknown> | undefined;
  if (row.type !== "import" || row.scope.bookId !== input.bookId || row.config_snapshot.scopeHash !== input.scopeHash
    || row.config_snapshot.autoStartL1 !== input.autoStartL1 || !source
    || typeof source.provider !== "string" || typeof source.sourceId !== "string"
    || typeof source.startChapter !== "number" || typeof source.endChapter !== "number") return false;
  const frozenSource = source as Source;
  return row.scope.startChapter === frozenSource.startChapter && row.scope.endChapter === frozenSource.endChapter
    && typeof row.config_snapshot.sourceVersion === "string";
}

export async function createImportL1Handoff(database: DatabaseExecutor, input: { importJobId: string; bookId: string; requestedBy: string }): Promise<void> {
  await createImportL1Job(database, input);
}

async function selectImportScope(database: DatabaseExecutor, bookId: string): Promise<Selection> {
  const sourceRow = await database.selectFrom("books")
    .innerJoin("book_sources", "book_sources.book_id", "books.id")
    .select(["book_sources.provider", "book_sources.source_id", "book_sources.start_chapter", "book_sources.end_chapter"])
    .where("books.id", "=", bookId)
    .where("books.status", "=", "active")
    .executeTakeFirst();
  if (!sourceRow) throw new BookNotFoundError();
  const source = { provider: sourceRow.provider, sourceId: sourceRow.source_id, startChapter: sourceRow.start_chapter, endChapter: sourceRow.end_chapter };
  validateSource(source);
  const version = buildImportSourceVersion(source);
  const chapters = await database.selectFrom("chapters")
    .select(["chapter_index", "source_version"])
    .where("book_id", "=", bookId)
    .where("chapter_index", ">=", source.startChapter)
    .where("chapter_index", "<=", source.endChapter)
    .execute();
  const byIndex = new Map(chapters.map((chapter) => [chapter.chapter_index, chapter.source_version]));
  const executableIndexes: number[] = [];
  let existingFresh = 0;
  let existingStale = 0;
  for (let chapterIndex = source.startChapter; chapterIndex <= source.endChapter; chapterIndex += 1) {
    const existingVersion = byIndex.get(chapterIndex);
    if (existingVersion === version) existingFresh += 1;
    else {
      if (existingVersion !== undefined) existingStale += 1;
      executableIndexes.push(chapterIndex);
    }
  }
  const requested = source.endChapter - source.startChapter + 1;
  const hashValue = { bookId, source, sourceVersion: version, executableIndexes };
  return {
    requested,
    existingFresh,
    existingStale,
    executable: executableIndexes.length,
    scopeHash: createHash("sha256").update(JSON.stringify(hashValue)).digest("hex"),
    source,
    sourceVersion: version,
    executableIndexes,
  };
}

export * from "./l1-job.js";

export class ImportJobService {
  constructor(private readonly database: DatabaseConnection) {}

  async preview(input: { bookId: string }): Promise<ImportScopePreview> {
    const selection = await selectImportScope(this.database, input.bookId);
    return {
      requested: selection.requested,
      existingFresh: selection.existingFresh,
      existingStale: selection.existingStale,
      executable: selection.executable,
      scopeHash: selection.scopeHash,
    };
  }

  async create(input: { bookId: string; requestedBy: string; requestId: string; scopeHash: string; autoStartL1: boolean }): Promise<PublicJob> {
    try {
      return await this.database.transaction().execute(async (transaction) => {
        const book = await transaction.selectFrom("books").select("id").where("id", "=", input.bookId).forUpdate().executeTakeFirst();
        if (!book) throw new BookNotFoundError();
        const storedRequestId = importRequestId(input.bookId, input.requestId);
        const replay = await transaction.selectFrom("jobs").select([...PUBLIC_JOB_COLUMNS, "config_snapshot"])
          .where("requested_by", "=", input.requestedBy).where("request_id", "=", storedRequestId).executeTakeFirst();
        if (replay) {
          if (!replayMatches(replay, input)) throw new IdempotencyConflictError();
          if (replay.status === "completed" && replay.config_snapshot.autoStartL1 === true) {
            await createImportL1Handoff(transaction, { importJobId: replay.id, bookId: input.bookId, requestedBy: input.requestedBy });
          }
          return jobRowToPublic(replay);
        }
        const selection = await selectImportScope(transaction, input.bookId);
        if (selection.scopeHash !== input.scopeHash) throw new ScopeChangedError();
        const concurrencyKey = `import:${input.bookId}`;
        const active = await transaction.selectFrom("jobs").select([...PUBLIC_JOB_COLUMNS, "config_snapshot"])
          .where("concurrency_key", "=", concurrencyKey)
          .where("status", "in", ["queued", "running", "retrying", "paused"])
          .executeTakeFirst();
        if (active) {
          if (!selectionMatches(active, selection, input.bookId, input.autoStartL1)) throw new IdempotencyConflictError();
          return jobRowToPublic(active);
        }

        const inserted = await transaction.insertInto("jobs").values({
          type: "import",
          status: selection.executable === 0 ? "completed" : "queued",
          requested_by: input.requestedBy,
          request_id: storedRequestId,
          scope: { bookId: input.bookId, startChapter: selection.source.startChapter, endChapter: selection.source.endChapter },
          config_snapshot: { source: selection.source, sourceVersion: selection.sourceVersion, scopeHash: selection.scopeHash, autoStartL1: input.autoStartL1 },
          concurrency_key: selection.executable === 0 ? null : concurrencyKey,
          progress: { total: selection.executable, completed: 0, failed: 0, skipped: 0, current: "" },
        }).returning(PUBLIC_JOB_COLUMNS).executeTakeFirstOrThrow();
        const job = jobRowToPublic(inserted);
        if (selection.executableIndexes.length > 0) {
          await transaction.insertInto("job_steps").values(selection.executableIndexes.map((chapterIndex) => ({
            job_id: job.id,
            position: chapterIndex,
            kind: "chapter-import",
            status: "queued" as const,
            input_signature: `${selection.sourceVersion}:${chapterIndex}`,
            idempotency_key: `${job.id}:chapter:${chapterIndex}`,
            output_ref: null,
            lease_owner: null,
            lease_expires_at: null,
          }))).execute();
        }
        await transaction.insertInto("job_events").values({ job_id: job.id, type: "created", dedupe_key: "created", payload: { status: job.status } }).execute();
        if (selection.executable === 0 && input.autoStartL1) {
          await createImportL1Handoff(transaction, { importJobId: job.id, bookId: input.bookId, requestedBy: input.requestedBy });
        }
        if (selection.executable > 0) {
          await transaction.insertInto("job_outbox").values({ job_id: job.id, topic: "jobs.wake", payload: { jobId: job.id }, claimed_by: null, claim_expires_at: null, delivered_at: null }).execute();
        }
        return job;
      });
    } catch (error) {
      if ((error as { code?: string }).code !== "23505") throw error;
      const storedRequestId = importRequestId(input.bookId, input.requestId);
      const selection = await selectImportScope(this.database, input.bookId);
      if (selection.scopeHash !== input.scopeHash) throw new ScopeChangedError();
      const existing = await this.database.selectFrom("jobs").select([...PUBLIC_JOB_COLUMNS, "config_snapshot"])
        .where((expression) => expression.or([
          expression.and([expression("requested_by", "=", input.requestedBy), expression("request_id", "=", storedRequestId)]),
          expression.and([expression("concurrency_key", "=", `import:${input.bookId}`), expression("status", "in", ["queued", "running", "retrying", "paused"])]),
        ])).orderBy("created_at").executeTakeFirst();
      if (!existing) throw error;
      if (!selectionMatches(existing, selection, input.bookId, input.autoStartL1)) throw new IdempotencyConflictError();
      return jobRowToPublic(existing);
    }
  }
}
