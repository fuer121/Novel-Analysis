import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const SYNTHETIC_LEGACY_MASTER_KEY = Buffer.alloc(32, 7);

const createSnapshot = (filePath: string, emptyChapter: boolean): void => {
  mkdirSync(dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  try {
    db.exec(`
      CREATE TABLE books (
        book_id TEXT PRIMARY KEY,
        book_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE chapters (
        book_id TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        title TEXT NOT NULL,
        content_hmac TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        iv TEXT NOT NULL,
        tag TEXT NOT NULL,
        algorithm TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO books VALUES (?, ?, ?, ?)").run(
      "book-source-1",
      emptyChapter ? "" : "Synthetic Book",
      "2026-01-01T00:00:00.000Z",
      "2026-01-03T00:00:00.000Z",
    );
    const insert = db.prepare("INSERT INTO chapters VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const chapterIndex of [2, 1]) {
      const isEmpty = emptyChapter && chapterIndex === 1;
      const plaintext = isEmpty ? "" : `Synthetic chapter ${chapterIndex}`;
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", SYNTHETIC_LEGACY_MASTER_KEY, iv);
      cipher.setAAD(Buffer.from(`chapter:book-source-1:${chapterIndex}`));
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      insert.run(
        "book-source-1",
        chapterIndex,
        isEmpty ? "" : `Chapter ${chapterIndex}`,
        createHmac("sha256", SYNTHETIC_LEGACY_MASTER_KEY).update(plaintext).digest("hex"),
        ciphertext.toString("base64"),
        iv.toString("base64"),
        cipher.getAuthTag().toString("base64"),
        "aes-256-gcm",
        `2026-01-0${chapterIndex + 1}T00:00:00.000Z`,
      );
    }
  } finally {
    db.close();
  }
};

export const createLegacySnapshot = (filePath: string): void => createSnapshot(filePath, false);

export const createEmptyLegacySnapshot = (filePath: string): void => createSnapshot(filePath, true);

export const createTwoBookLegacySnapshot = (filePath: string): void => {
  createLegacySnapshot(filePath);
  const db = new DatabaseSync(filePath);
  try {
    db.prepare("INSERT INTO books VALUES (?, ?, ?, ?)").run(
      "book-source-2",
      "Synthetic Book Two",
      "2026-02-01T00:00:00.000Z",
      "2026-02-03T00:00:00.000Z",
    );
    const insert = db.prepare("INSERT INTO chapters VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const chapterIndex of [1, 2]) {
      const plaintext = `Second book chapter ${chapterIndex}`;
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", SYNTHETIC_LEGACY_MASTER_KEY, iv);
      cipher.setAAD(Buffer.from(`chapter:book-source-2:${chapterIndex}`));
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      insert.run(
        "book-source-2",
        chapterIndex,
        `Second Chapter ${chapterIndex}`,
        createHmac("sha256", SYNTHETIC_LEGACY_MASTER_KEY).update(plaintext).digest("hex"),
        ciphertext.toString("base64"),
        iv.toString("base64"),
        cipher.getAuthTag().toString("base64"),
        "aes-256-gcm",
        `2026-02-0${chapterIndex + 1}T00:00:00.000Z`,
      );
    }
  } finally {
    db.close();
  }
};
