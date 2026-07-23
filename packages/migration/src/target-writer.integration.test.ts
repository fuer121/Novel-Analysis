import {
  createCipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { sql } from "kysely";
import {
  createContentCipher,
  type ContentCipher,
} from "@novel-analysis/database";
import {
  createDisposablePostgres,
  type DisposablePostgres,
} from "../../database/src/testing/postgres.js";
import { SYNTHETIC_LEGACY_MASTER_KEY } from "../../../test/phase5/fixtures/create-legacy-snapshot.js";
import type { LegacyBook, LegacyChapter } from "./contracts.js";
import { createMigrationManifest } from "./manifest.js";
import { stableTargetId } from "./stable-id.js";
import { createTargetWriter } from "./target-writer.js";

const SOURCE_FINGERPRINT = "a".repeat(64);
const TARGET_SCHEMA_VERSION = "phase5-test";
const PLAINTEXT_SENTINEL = `SENTINEL_CHAPTER_TEXT_${randomUUID()}`;
const OLD_KEY_SENTINEL = "SENTINEL_OLD_KEY";
const TARGET_KEY_SENTINEL = "SENTINEL_TARGET_KEY";
const HMAC_KEY_SENTINEL = "SENTINEL_HMAC_KEY";

const oldMasterKey = Buffer.from(SYNTHETIC_LEGACY_MASTER_KEY);
const targetKey = createHash("sha256").update(TARGET_KEY_SENTINEL).digest();
const targetHmacKey = createHash("sha256").update(HMAC_KEY_SENTINEL).digest();
const targetCipher = createContentCipher({
  activeKeyVersion: "migration-v1",
  keys: { "migration-v1": targetKey },
});

const book: LegacyBook = {
  sourceId: "legacy-book-1",
  title: "Synthetic Book",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-03T00:00:00.000Z",
};

function encryptedChapter(
  chapterIndex: number,
  plaintext: string,
  title: string = `Chapter ${chapterIndex}`,
  sourceBook: LegacyBook = book,
): LegacyChapter {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", oldMasterKey, nonce);
  cipher.setAAD(Buffer.from(`chapter:${sourceBook.sourceId}:${chapterIndex}`));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    bookSourceId: sourceBook.sourceId,
    chapterIndex,
    title,
    contentHmac: createHmac("sha256", oldMasterKey).update(plaintext).digest("hex"),
    ciphertext: ciphertext.toString("base64"),
    iv: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    algorithm: "aes-256-gcm",
    updatedAt: `2026-01-0${chapterIndex + 1}T00:00:00.000Z`,
  };
}

async function setup(cipher: ContentCipher = targetCipher) {
  const postgres = await createDisposablePostgres();
  disposables.push(postgres);
  const owner = await postgres.db
    .insertInto("users")
    .values({ display_name: "Migration Owner", role: "admin", status: "active" })
    .returning("id")
    .executeTakeFirstOrThrow();
  const writer = await createTargetWriter({
    database: postgres.db,
    createdBy: owner.id,
    sourceFingerprint: SOURCE_FINGERPRINT,
    oldMasterKey,
    targetCipher: cipher,
    targetHmacKey,
  });
  return { postgres, owner, writer };
}

const disposables: DisposablePostgres[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(disposables.splice(0).map((postgres) => postgres.destroy()));
});

describe("target writer", () => {
  test("writes a complete book with stable IDs and target crypto roundtrip", async () => {
    const { postgres, writer } = await setup();
    const chapters = [
      encryptedChapter(1, PLAINTEXT_SENTINEL),
      encryptedChapter(2, "Synthetic chapter 2"),
    ];

    const result = await writer.writeBook(book, chapters);
    const expectedBookId = stableTargetId(
      SOURCE_FINGERPRINT,
      `book:${book.sourceId}`,
    );
    expect(result).toMatchObject({
      targetId: expectedBookId,
      chapterCount: 2,
      status: "completed",
    });
    expect(result.sourceIdHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.contentDigest).toMatch(/^[a-f0-9]{64}$/);

    const storedBook = await postgres.db
      .selectFrom("books")
      .selectAll()
      .where("id", "=", expectedBookId)
      .executeTakeFirstOrThrow();
    expect(storedBook.title).toBe(book.title);
    const source = await postgres.db
      .selectFrom("book_sources")
      .selectAll()
      .where("book_id", "=", expectedBookId)
      .executeTakeFirstOrThrow();
    expect(source).toMatchObject({
      provider: "legacy-sqlite",
      source_id: book.sourceId,
      start_chapter: 1,
      end_chapter: 2,
    });

    const rows = await postgres.db
      .selectFrom("chapters")
      .selectAll()
      .where("book_id", "=", expectedBookId)
      .orderBy("chapter_index")
      .execute();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).toBe(stableTargetId(
      SOURCE_FINGERPRINT,
      `chapter:${book.sourceId}:1`,
    ));
    expect(targetCipher.decrypt({
      ciphertext: rows[0]!.content_ciphertext,
      nonce: rows[0]!.content_nonce,
      tag: rows[0]!.content_tag,
      keyVersion: rows[0]!.content_key_version,
    })).toBe(PLAINTEXT_SENTINEL);
    expect(rows[0]!.content_hmac).toBe(
      createHmac("sha256", targetHmacKey).update(PLAINTEXT_SENTINEL).digest("hex"),
    );
  });

  test("rejects corrupt source authentication without partial persistence", async () => {
    const { postgres, writer } = await setup();
    await writer.writeBook(book, [encryptedChapter(1, "First book chapter")]);
    const corruptBook = {
      ...book,
      sourceId: "legacy-book-2",
      title: "Corrupt Book",
    };
    const valid = encryptedChapter(1, PLAINTEXT_SENTINEL, "Corrupt", corruptBook);
    const corruptTag = Buffer.from(valid.tag, "base64");
    corruptTag[0] ^= 1;

    const error = await writer
      .writeBook(corruptBook, [{ ...valid, tag: corruptTag.toString("base64") }])
      .catch((caught: unknown) => caught);

    expect(error).toEqual(new Error("source_decrypt_failed"));
    expect(JSON.stringify(error)).not.toContain(PLAINTEXT_SENTINEL);
    expect(await postgres.db.selectFrom("books").select(({ fn }) => fn.countAll<number>().as("count")).executeTakeFirstOrThrow()).toEqual({ count: "1" });
    const corruptTargetId = stableTargetId(
      SOURCE_FINGERPRINT,
      `book:${corruptBook.sourceId}`,
    );
    expect(await postgres.db.selectFrom("books").select("id").where("id", "=", corruptTargetId).execute()).toEqual([]);
    expect(await postgres.db.selectFrom("chapters").select("id").where("book_id", "=", corruptTargetId).execute()).toEqual([]);
  });

  test("rejects source HMAC mismatch without disclosing content", async () => {
    const { writer } = await setup();
    const chapter = encryptedChapter(1, PLAINTEXT_SENTINEL);
    const error = await writer
      .writeBook(book, [{ ...chapter, contentHmac: "0".repeat(64) }])
      .catch((caught: unknown) => caught);

    expect(error).toEqual(new Error("source_hmac_mismatch"));
    expect(String(error)).not.toContain(PLAINTEXT_SENTINEL);
  });

  test("redacts target encryption failures that contain plaintext", async () => {
    const leakingCipher: ContentCipher = {
      encrypt(plaintext) {
        throw new Error(plaintext);
      },
      decrypt: targetCipher.decrypt,
    };
    const { writer } = await setup(leakingCipher);

    const error = await writer
      .writeBook(book, [encryptedChapter(1, PLAINTEXT_SENTINEL)])
      .catch((caught: unknown) => caught);

    expect(error).toEqual(new Error("target_encrypt_failed"));
    expect(JSON.stringify(error)).not.toContain(PLAINTEXT_SENTINEL);
    expect(String(error)).not.toContain(PLAINTEXT_SENTINEL);
  });

  test("rolls back the complete book when a chapter insert fails", async () => {
    const { postgres, writer } = await setup();
    const chapters = [
      encryptedChapter(1, PLAINTEXT_SENTINEL),
      encryptedChapter(2, "Synthetic chapter 2", null as never),
    ];

    const error = await writer.writeBook(book, chapters).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    const targetBookId = stableTargetId(SOURCE_FINGERPRINT, `book:${book.sourceId}`);
    expect(await postgres.db.selectFrom("books").select("id").where("id", "=", targetBookId).execute()).toEqual([]);
    expect(await postgres.db.selectFrom("book_sources").select("id").where("book_id", "=", targetBookId).execute()).toEqual([]);
    expect(await postgres.db.selectFrom("chapters").select("id").where("book_id", "=", targetBookId).execute()).toEqual([]);
  });

  test("fails closed when the target is non-empty or the target book already exists", async () => {
    const postgres = await createDisposablePostgres();
    disposables.push(postgres);
    const owner = await postgres.db
      .insertInto("users")
      .values({ display_name: "Migration Owner", role: "admin", status: "active" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const targetId = stableTargetId(SOURCE_FINGERPRINT, `book:${book.sourceId}`);
    await postgres.db.insertInto("books").values({
      id: targetId,
      title: "Existing",
      created_by: owner.id,
      status: "active",
    }).execute();

    await expect(createTargetWriter({
      database: postgres.db,
      createdBy: owner.id,
      sourceFingerprint: SOURCE_FINGERPRINT,
      oldMasterKey,
      targetCipher,
      targetHmacKey,
    })).rejects.toThrow("target_not_empty");
  });

  test("rejects a target book inserted after the empty-target preflight", async () => {
    const { postgres, owner, writer } = await setup();
    const targetId = stableTargetId(SOURCE_FINGERPRINT, `book:${book.sourceId}`);
    await postgres.db.insertInto("books").values({
      id: targetId,
      title: "Racing target",
      created_by: owner.id,
      status: "active",
    }).execute();

    await expect(
      writer.writeBook(book, [encryptedChapter(1, PLAINTEXT_SENTINEL)]),
    ).rejects.toThrow("target_not_empty");
    expect(await postgres.db.selectFrom("chapters").select("id").where("book_id", "=", targetId).execute()).toEqual([]);
  });

  test("produces stable UUID mappings with distinct object identities", () => {
    const first = stableTargetId(SOURCE_FINGERPRINT, "book:legacy-book-1");
    expect(first).toBe(stableTargetId(SOURCE_FINGERPRINT, "book:legacy-book-1"));
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first).not.toBe(stableTargetId(SOURCE_FINGERPRINT, "book:legacy-book-2"));
    expect(first).not.toBe(stableTargetId("b".repeat(64), "book:legacy-book-1"));
  });

  test("keeps plaintext and key sentinels out of manifest, logs, errors, and plaintext columns", async () => {
    const logs = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];
    const { postgres, writer } = await setup();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const entry = await writer.writeBook(book, [
      encryptedChapter(1, PLAINTEXT_SENTINEL),
    ]);
    const manifest = createMigrationManifest({
      sourceFingerprint: SOURCE_FINGERPRINT,
      targetSchemaVersion: TARGET_SCHEMA_VERSION,
      startedAt,
      completedAt: new Date("2026-01-01T00:00:01.000Z"),
      books: [entry],
    });

    expect(Object.keys(manifest).sort()).toEqual([
      "books",
      "completedAt",
      "manifestVersion",
      "sourceFingerprint",
      "startedAt",
      "targetSchemaVersion",
    ]);
    expect(Object.keys(manifest.books[0]!).sort()).toEqual([
      "chapterCount",
      "contentDigest",
      "durationMs",
      "sourceIdHash",
      "status",
      "targetId",
    ]);
    const captured = JSON.stringify({ manifest, logs: logs.map((log) => log.mock.calls) });
    for (const sentinel of [
      PLAINTEXT_SENTINEL,
      OLD_KEY_SENTINEL,
      TARGET_KEY_SENTINEL,
      HMAC_KEY_SENTINEL,
      oldMasterKey.toString("hex"),
      targetKey.toString("hex"),
      targetHmacKey.toString("hex"),
    ]) {
      expect(captured).not.toContain(sentinel);
    }

    const columns = await sql<{ column_name: string }>`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name in ('books', 'book_sources', 'chapters')
    `.execute(postgres.db);
    expect(columns.rows.map((row) => row.column_name)).not.toEqual(
      expect.arrayContaining(["plaintext", "content", "body"]),
    );
    const targetRows = await sql<Record<string, unknown>>`
      select b.*, s.*, c.*
      from books b
      join book_sources s on s.book_id = b.id
      join chapters c on c.book_id = b.id
    `.execute(postgres.db);
    expect(JSON.stringify(targetRows.rows)).not.toContain(PLAINTEXT_SENTINEL);
  });
});
