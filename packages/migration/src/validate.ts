import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  ContentCipher,
  DatabaseConnection,
  EncryptedContent,
} from "@novel-analysis/database";
import type { LegacySnapshotReader } from "./contracts.js";
import { decryptLegacyChapter, plaintextDigest } from "./legacy-crypto.js";
import { stableTargetId } from "./stable-id.js";

export const VALIDATION_NAMES = [
  "book-count",
  "chapter-count",
  "metadata",
  "source-integrity",
  "content-digest",
  "target-decrypt",
  "target-hmac",
  "scope-exclusion",
] as const;

export type ValidationName = typeof VALIDATION_NAMES[number];
export type ValidationSummary = Readonly<{
  name: ValidationName;
  passed: true;
  checked: number;
}>;

export class MigrationHardFailure extends Error {
  readonly codes: readonly string[];

  constructor(codes: readonly string[]) {
    super(`migration_hard_failure:${codes.join(",")}`);
    this.name = "MigrationHardFailure";
    this.codes = Object.freeze([...codes]);
  }
}

export type ValidateMigrationInput = Readonly<{
  database: DatabaseConnection;
  source: LegacySnapshotReader;
  oldMasterKey: Buffer;
  targetCipher: ContentCipher;
  targetHmacKey: Buffer;
}>;

type TargetChapter = Readonly<{
  id: string;
  book_id: string;
  chapter_index: number;
  title: string;
  content_hmac: string;
  content_ciphertext: Buffer;
  content_nonce: Buffer;
  content_tag: Buffer;
  content_key_version: string;
  source_version: string;
}>;

const equalBuffer = (left: Buffer, right: Buffer): boolean =>
  left.length === right.length && timingSafeEqual(left, right);

export async function validateMigration(
  input: ValidateMigrationInput,
): Promise<readonly ValidationSummary[]> {
  const failures: string[] = [];
  const summaries: ValidationSummary[] = [];
  const books = input.source.books();
  const sourceChapters = books.flatMap((book) => input.source.chapters(book.sourceId));
  const targetBooks = await input.database.selectFrom("books").selectAll().orderBy("id").execute();
  const targetSources = await input.database.selectFrom("book_sources").selectAll().orderBy("book_id").execute();
  const targetChapters: TargetChapter[] = await input.database
    .selectFrom("chapters")
    .select([
      "id", "book_id", "chapter_index", "title", "content_hmac",
      "content_ciphertext", "content_nonce", "content_tag",
      "content_key_version", "source_version",
    ])
    .orderBy("book_id")
    .orderBy("chapter_index")
    .execute();

  const check = (name: ValidationName, checked: number, passed: boolean): void => {
    if (passed) summaries.push(Object.freeze({ name, passed: true, checked }));
    else failures.push(name);
  };

  check("book-count", books.length, targetBooks.length === books.length);
  check("chapter-count", sourceChapters.length, targetChapters.length === sourceChapters.length);

  const metadataPassed = books.every((book) => {
    const targetId = stableTargetId(input.source.fingerprint(), `book:${book.sourceId}`);
    const target = targetBooks.find((item) => item.id === targetId);
    if (!target || target.title !== book.title
      || target.created_at.toISOString() !== new Date(book.createdAt).toISOString()
      || target.updated_at.toISOString() !== new Date(book.updatedAt).toISOString()) return false;
    return input.source.chapters(book.sourceId).every((chapter) => {
      const row = targetChapters.find((item) =>
        item.book_id === targetId && item.chapter_index === chapter.chapterIndex);
      return row?.title === chapter.title;
    });
  });
  check("metadata", books.length + sourceChapters.length, metadataPassed);

  const sourceIntegrityPassed = books.every((book) => {
    const targetId = stableTargetId(input.source.fingerprint(), `book:${book.sourceId}`);
    const chapters = input.source.chapters(book.sourceId);
    const source = targetSources.find((item) => item.book_id === targetId);
    return source?.provider === "legacy-sqlite"
      && source.source_id === book.sourceId
      && source.start_chapter === Math.min(...chapters.map((chapter) => chapter.chapterIndex))
      && source.end_chapter === Math.max(...chapters.map((chapter) => chapter.chapterIndex))
      && chapters.every((chapter) =>
        targetChapters.some((target) =>
          target.id === stableTargetId(
            input.source.fingerprint(),
            `chapter:${book.sourceId}:${chapter.chapterIndex}`,
          )));
  });
  check("source-integrity", books.length + sourceChapters.length, sourceIntegrityPassed);

  let digestPassed = true;
  let decryptPassed = true;
  let hmacPassed = true;
  for (const book of books) {
    const targetId = stableTargetId(input.source.fingerprint(), `book:${book.sourceId}`);
    for (const chapter of input.source.chapters(book.sourceId)) {
      const target = targetChapters.find((item) =>
        item.book_id === targetId && item.chapter_index === chapter.chapterIndex);
      if (!target) {
        digestPassed = false;
        decryptPassed = false;
        hmacPassed = false;
        continue;
      }
      const source = decryptLegacyChapter(chapter, input.oldMasterKey);
      let targetPlaintext: string | undefined;
      try {
        const encrypted: EncryptedContent = {
          ciphertext: target.content_ciphertext,
          nonce: target.content_nonce,
          tag: target.content_tag,
          keyVersion: target.content_key_version,
        };
        targetPlaintext = input.targetCipher.decrypt(encrypted);
      } catch {
        decryptPassed = false;
      }
      if (target.source_version !== source.digest
        || targetPlaintext === undefined
        || plaintextDigest(targetPlaintext) !== source.digest) digestPassed = false;
      if (targetPlaintext !== undefined) {
        const expectedHmac = createHmac("sha256", input.targetHmacKey)
          .update(targetPlaintext, "utf8")
          .digest();
        const actualHmac = Buffer.from(target.content_hmac, "hex");
        if (!equalBuffer(expectedHmac, actualHmac)) hmacPassed = false;
      } else {
        hmacPassed = false;
      }
    }
  }
  check("content-digest", sourceChapters.length, digestPassed);
  check("target-decrypt", sourceChapters.length, decryptPassed);
  check("target-hmac", sourceChapters.length, hmacPassed);

  const excludedCounts = await Promise.all([
    "prompt_versions", "workflow_versions", "index_groups", "l1_indexes",
    "l2_chapter_statuses", "l2_facts", "l2_subjects", "query_sessions",
    "query_turns", "turn_evidence", "analysis_templates",
    "analysis_template_versions", "analysis_runs", "analysis_parts",
    "jobs", "job_steps", "job_attempts", "job_events", "job_outbox",
    "auth_identities", "oauth_states", "sessions", "audit_logs",
  ].map(async (table) => {
    const result = await input.database
      .selectFrom(table as "jobs")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow();
    return Number(result.count);
  }));
  check(
    "scope-exclusion",
    excludedCounts.length,
    excludedCounts.every((count) => count === 0),
  );

  if (failures.length > 0) throw new MigrationHardFailure(failures);
  return Object.freeze(summaries);
}
