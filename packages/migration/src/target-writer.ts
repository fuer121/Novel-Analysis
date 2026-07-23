import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type {
  ContentCipher,
  DatabaseConnection,
  EncryptedContent,
} from "@novel-analysis/database";
import type {
  LegacyBook,
  LegacyChapter,
  MigrationBookManifest,
  TargetWriter,
} from "./contracts.js";
import { decryptLegacyChapter } from "./legacy-crypto.js";
import { stableTargetId } from "./stable-id.js";

export type CreateTargetWriterInput = Readonly<{
  database: DatabaseConnection;
  createdBy: string;
  sourceFingerprint: string;
  oldMasterKey: Buffer;
  targetCipher: ContentCipher;
  targetHmacKey: Buffer;
}>;

type PreparedChapter = Readonly<{
  id: string;
  chapterIndex: number;
  title: string;
  contentHmac: string;
  encrypted: EncryptedContent;
  sourceVersion: string;
  digest: string;
}>;

const hash = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const assertKeys = (oldMasterKey: Buffer, targetHmacKey: Buffer): void => {
  if (oldMasterKey.length !== 32) {
    throw new Error("invalid_old_master_key");
  }
  if (
    targetHmacKey.length < 32
    || (
      targetHmacKey.length === oldMasterKey.length
      && timingSafeEqual(targetHmacKey, oldMasterKey)
    )
  ) {
    throw new Error("invalid_target_hmac_key");
  }
};

const prepareChapters = (
  book: LegacyBook,
  chapters: readonly LegacyChapter[],
  input: CreateTargetWriterInput,
): readonly PreparedChapter[] => {
  if (chapters.length === 0) {
    throw new Error("source_book_has_no_chapters");
  }
  return chapters.map((chapter) => {
    if (chapter.bookSourceId !== book.sourceId) {
      throw new Error("source_book_mismatch");
    }
    const source = decryptLegacyChapter(chapter, input.oldMasterKey);
    let encrypted: EncryptedContent;
    try {
      encrypted = input.targetCipher.encrypt(source.plaintext);
    } catch {
      throw new Error("target_encrypt_failed");
    }
    return Object.freeze({
      id: stableTargetId(
        input.sourceFingerprint,
        `chapter:${book.sourceId}:${chapter.chapterIndex}`,
      ),
      chapterIndex: chapter.chapterIndex,
      title: chapter.title,
      contentHmac: createHmac("sha256", input.targetHmacKey)
        .update(source.plaintext, "utf8")
        .digest("hex"),
      encrypted,
      sourceVersion: source.digest,
      digest: source.digest,
    });
  });
};

export async function createTargetWriter(
  input: CreateTargetWriterInput,
): Promise<TargetWriter> {
  assertKeys(input.oldMasterKey, input.targetHmacKey);
  const initial = await input.database
    .selectFrom("books")
    .select(({ fn }) => fn.countAll<number>().as("count"))
    .executeTakeFirstOrThrow();
  if (Number(initial.count) !== 0) {
    throw new Error("target_not_empty");
  }

  const writtenBookIds = new Set<string>();
  return Object.freeze({
    async writeBook(
      book: LegacyBook,
      chapters: readonly LegacyChapter[],
    ): Promise<MigrationBookManifest> {
      const startedAt = performance.now();
      const targetBookId = stableTargetId(
        input.sourceFingerprint,
        `book:${book.sourceId}`,
      );
      const prepared = prepareChapters(book, chapters, input);
      const chapterIndexes = prepared.map((chapter) => chapter.chapterIndex);

      await input.database.transaction()
        .setIsolationLevel("serializable")
        .execute(async (transaction) => {
          const targetBooks = await transaction
            .selectFrom("books")
            .select("id")
            .execute();
          if (targetBooks.some(({ id }) => !writtenBookIds.has(id))) {
            throw new Error("target_not_empty");
          }
          if (targetBooks.some(({ id }) => id === targetBookId)) {
            throw new Error("target_book_present");
          }

          await transaction.insertInto("books").values({
            id: targetBookId,
            title: book.title,
            status: "active",
            created_by: input.createdBy,
            created_at: book.createdAt,
            updated_at: book.updatedAt,
          }).execute();
          await transaction.insertInto("book_sources").values({
            book_id: targetBookId,
            provider: "legacy-sqlite",
            source_id: book.sourceId,
            start_chapter: Math.min(...chapterIndexes),
            end_chapter: Math.max(...chapterIndexes),
            created_at: book.createdAt,
            updated_at: book.updatedAt,
          }).execute();
          for (const chapter of prepared) {
            await transaction.insertInto("chapters").values({
              id: chapter.id,
              book_id: targetBookId,
              chapter_index: chapter.chapterIndex,
              title: chapter.title,
              content_hmac: chapter.contentHmac,
              content_ciphertext: chapter.encrypted.ciphertext,
              content_nonce: chapter.encrypted.nonce,
              content_tag: chapter.encrypted.tag,
              content_key_version: chapter.encrypted.keyVersion,
              source_version: chapter.sourceVersion,
            }).execute();
          }
        });

      writtenBookIds.add(targetBookId);
      const contentDigest = createHash("sha256");
      for (const chapter of prepared) {
        contentDigest
          .update(String(chapter.chapterIndex), "utf8")
          .update("\0")
          .update(chapter.digest, "utf8")
          .update("\0");
      }
      return Object.freeze({
        sourceIdHash: hash(book.sourceId),
        targetId: targetBookId,
        chapterCount: prepared.length,
        contentDigest: contentDigest.digest("hex"),
        durationMs: Math.max(0, performance.now() - startedAt),
        status: "completed",
      });
    },
  });
}
