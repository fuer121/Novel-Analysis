import { createDecipheriv, createHash, createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createLegacySnapshot, SYNTHETIC_LEGACY_MASTER_KEY } from "../../../test/phase5/fixtures/create-legacy-snapshot.js";
import { createLegacySnapshotOpener, openLegacySnapshot } from "./legacy-reader.js";

const temporaryDirectories: string[] = [];
const sha256 = (filePath: string) => createHash("sha256").update(readFileSync(filePath)).digest("hex");

const snapshot = async () => {
  const directory = await mkdtemp(join(tmpdir(), "legacy snapshot #"));
  temporaryDirectories.push(directory);
  const filePath = join(directory, "legacy # snapshot.sqlite");
  createLegacySnapshot(filePath);
  return filePath;
};

const mutate = (filePath: string, sql: string): void => {
  const db = new DatabaseSync(filePath);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("openLegacySnapshot", () => {
  it("reads the synthetic snapshot in stable order without changing its hash", async () => {
    const filePath = await snapshot();
    mutate(filePath, `INSERT INTO books VALUES ('book-source-0', 'Earlier Book', '2025-01-01', '2025-01-02')`);
    const before = sha256(filePath);

    const reader = openLegacySnapshot({ filePath, readOnly: true });
    expect(reader.fingerprint()).toBe(before);
    expect(reader.books().map((book) => book.sourceId)).toEqual(["book-source-0", "book-source-1"]);
    expect(reader.books()[1]).toEqual({
      sourceId: "book-source-1",
      title: "Synthetic Book",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
    });
    expect(reader.chapters("book-source-1").map((chapter) => chapter.chapterIndex)).toEqual([1, 2]);
    expect(reader.chapters("book-source-1")[0]).toMatchObject({
      bookSourceId: "book-source-1",
      title: "Chapter 1",
      contentHmac: expect.stringMatching(/^[a-f0-9]{64}$/),
      algorithm: "aes-256-gcm",
    });
    reader.close();

    expect(sha256(filePath)).toBe(before);
  });

  it("produces independently decryptable fixture chapters with exact AAD and HMAC", async () => {
    const filePath = await snapshot();
    const reader = openLegacySnapshot({ filePath, readOnly: true });
    for (const chapter of reader.chapters("book-source-1")) {
      const decipher = createDecipheriv("aes-256-gcm", SYNTHETIC_LEGACY_MASTER_KEY, Buffer.from(chapter.iv, "base64"));
      decipher.setAAD(Buffer.from(`chapter:${chapter.bookSourceId}:${chapter.chapterIndex}`));
      decipher.setAuthTag(Buffer.from(chapter.tag, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(chapter.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8");
      expect(plaintext).toBe(`Synthetic chapter ${chapter.chapterIndex}`);
      expect(chapter.contentHmac).toBe(createHmac("sha256", SYNTHETIC_LEGACY_MASTER_KEY).update(plaintext).digest("hex"));
    }
    reader.close();
  });

  it("opens the database read-only and enables query_only", async () => {
    const filePath = await snapshot();
    let capturedOptions: { readOnly: true } | undefined;
    let capturedDatabase: DatabaseSync | undefined;
    const open = createLegacySnapshotOpener((path, options) => {
      capturedOptions = options;
      capturedDatabase = new DatabaseSync(path, options);
      return capturedDatabase;
    });

    const reader = open({ filePath, readOnly: true });
    expect(capturedOptions).toEqual({ readOnly: true });
    expect(capturedDatabase!.prepare("PRAGMA query_only").get()).toEqual({ query_only: 1 });
    reader.close();
  });

  it("rejects a snapshot with committed WAL content", async () => {
    const filePath = await snapshot();
    const writer = new DatabaseSync(filePath);
    let opened = false;
    const open = createLegacySnapshotOpener((path, options) => {
      opened = true;
      return new DatabaseSync(path, options);
    });
    try {
      writer.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0");
      writer.prepare("INSERT INTO books VALUES (?, ?, ?, ?)").run("wal-book", "WAL Book", "2026-01-01", "2026-01-01");
      expect(readFileSync(`${filePath}-wal`).byteLength).toBeGreaterThan(0);
      expect(() => open({ filePath, readOnly: true })).toThrow("SQLite sidecar");
      expect(opened).toBe(false);
    } finally {
      writer.close();
    }
  });

  it("rejects a sidecar that appears while the snapshot is open", async () => {
    const filePath = await snapshot();
    const reader = openLegacySnapshot({ filePath, readOnly: true });
    writeFileSync(`${filePath}-wal`, "appeared");
    expect(() => reader.close()).toThrow("SQLite sidecar");
  });

  it.each([
    [{ filePath: "unused" }, "explicitly read-only"],
    [{ filePath: "unused", readOnly: false }, "explicitly read-only"],
  ])("rejects input that is not explicitly read-only", (input, message) => {
    expect(() => openLegacySnapshot(input as never)).toThrow(message);
  });

  it.each(["books", "chapters"])("rejects a missing required %s table", async (table) => {
    const filePath = await snapshot();
    mutate(filePath, `DROP TABLE ${table}`);
    expect(() => openLegacySnapshot({ filePath, readOnly: true })).toThrow(`required table: ${table}`);
  });

  it("rejects a required table with a missing required column", async () => {
    const filePath = await snapshot();
    mutate(filePath, "ALTER TABLE chapters DROP COLUMN tag");
    expect(() => openLegacySnapshot({ filePath, readOnly: true })).toThrow("required column: chapters.tag");
  });

  it("rejects duplicate chapter positions", async () => {
    const filePath = await snapshot();
    mutate(filePath, `INSERT INTO chapters SELECT book_id, chapter_index, 'Duplicate', content_hmac, ciphertext, iv, tag, algorithm, updated_at FROM chapters WHERE chapter_index = 1`);
    expect(() => openLegacySnapshot({ filePath, readOnly: true })).toThrow("duplicate chapter position");
  });

  it("rejects empty book and chapter identities", async () => {
    const filePath = await snapshot();
    mutate(filePath, "UPDATE books SET book_id = '   '; UPDATE chapters SET book_id = '   '");
    expect(() => openLegacySnapshot({ filePath, readOnly: true })).toThrow("books.book_id");
  });

  it.each([0, -1])("rejects non-positive chapter index %i", async (chapterIndex) => {
    const filePath = await snapshot();
    mutate(filePath, `UPDATE chapters SET chapter_index = ${chapterIndex} WHERE chapter_index = 1`);
    expect(() => openLegacySnapshot({ filePath, readOnly: true })).toThrow("chapters.chapter_index");
  });

  it("rejects duplicate book identities when the source omits its primary key", async () => {
    const filePath = await snapshot();
    mutate(filePath, `
      ALTER TABLE books RENAME TO old_books;
      CREATE TABLE books (book_id TEXT NOT NULL, book_name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO books SELECT * FROM old_books;
      INSERT INTO books SELECT * FROM old_books;
      DROP TABLE old_books;
    `);
    expect(() => openLegacySnapshot({ filePath, readOnly: true })).toThrow("duplicate book identity");
  });

  it("rejects a chapter whose book does not exist", async () => {
    const filePath = await snapshot();
    mutate(filePath, "UPDATE chapters SET book_id = 'missing-book' WHERE chapter_index = 1");
    expect(() => openLegacySnapshot({ filePath, readOnly: true })).toThrow("orphan chapter");
  });

  it.each([
    ["books", "book_name"],
    ["books", "created_at"],
    ["books", "updated_at"],
    ["chapters", "title"],
    ["chapters", "content_hmac"],
    ["chapters", "updated_at"],
  ])("rejects empty required metadata %s.%s", async (table, column) => {
    const filePath = await snapshot();
    mutate(filePath, `UPDATE ${table} SET ${column} = '   '`);
    expect(() => openLegacySnapshot({ filePath, readOnly: true })).toThrow(`${table}.${column}`);
  });

  it("rejects unsupported encryption algorithms", async () => {
    const filePath = await snapshot();
    mutate(filePath, "UPDATE chapters SET algorithm = 'aes-128-cbc' WHERE chapter_index = 1");
    expect(() => openLegacySnapshot({ filePath, readOnly: true })).toThrow("unsupported chapter algorithm");
  });

  it.each(["ciphertext", "iv", "tag"])("rejects an incomplete cipher tuple missing %s", async (column) => {
    const filePath = await snapshot();
    mutate(filePath, `UPDATE chapters SET ${column} = '' WHERE chapter_index = 1`);
    expect(() => openLegacySnapshot({ filePath, readOnly: true })).toThrow("incomplete chapter cipher tuple");
  });
});
