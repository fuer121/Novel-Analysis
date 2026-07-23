import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createLegacySnapshot } from "../../../test/phase5/fixtures/create-legacy-snapshot.js";
import { openLegacySnapshot } from "./legacy-reader.js";

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
