import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { LegacyBook, LegacyChapter, LegacySnapshotReader } from "./contracts.js";

export type OpenLegacySnapshotInput = Readonly<{
  filePath: string;
  readOnly: true;
}>;

const requiredColumns = {
  books: ["book_id", "book_name", "created_at", "updated_at"],
  chapters: ["book_id", "chapter_index", "title", "content_hmac", "ciphertext", "iv", "tag", "algorithm", "updated_at"],
} as const;

const sha256 = (filePath: string): string => createHash("sha256").update(readFileSync(filePath)).digest("hex");

const stringValue = (value: SQLInputValue, field: string): string => {
  if (typeof value !== "string") throw new Error(`invalid legacy value: ${field}`);
  return value;
};

const validateSchema = (db: DatabaseSync): void => {
  const tableExists = db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?");
  for (const [table, columns] of Object.entries(requiredColumns)) {
    if (!tableExists.get(table)) throw new Error(`missing required table: ${table}`);
    const actual = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
    for (const column of columns) {
      if (!actual.has(column)) throw new Error(`missing required column: ${table}.${column}`);
    }
  }
};

const readBooks = (db: DatabaseSync): readonly LegacyBook[] => Object.freeze(
  db.prepare("SELECT book_id, book_name, created_at, updated_at FROM books ORDER BY book_id").all().map((row) => Object.freeze({
    sourceId: stringValue(row.book_id, "books.book_id"),
    title: stringValue(row.book_name, "books.book_name"),
    createdAt: stringValue(row.created_at, "books.created_at"),
    updatedAt: stringValue(row.updated_at, "books.updated_at"),
  })),
);

const readChapters = (db: DatabaseSync): readonly LegacyChapter[] => {
  const rows = db.prepare(`
    SELECT book_id, chapter_index, title, content_hmac, ciphertext, iv, tag, algorithm, updated_at
    FROM chapters
    ORDER BY book_id, chapter_index
  `).all();
  const positions = new Set<string>();
  return Object.freeze(rows.map((row) => {
    const bookSourceId = stringValue(row.book_id, "chapters.book_id");
    if (typeof row.chapter_index !== "number" || !Number.isSafeInteger(row.chapter_index)) {
      throw new Error("invalid legacy value: chapters.chapter_index");
    }
    const position = `${bookSourceId}\0${row.chapter_index}`;
    if (positions.has(position)) throw new Error(`duplicate chapter position: ${bookSourceId}/${row.chapter_index}`);
    positions.add(position);

    const ciphertext = stringValue(row.ciphertext, "chapters.ciphertext");
    const iv = stringValue(row.iv, "chapters.iv");
    const tag = stringValue(row.tag, "chapters.tag");
    if (!ciphertext || !iv || !tag) throw new Error(`incomplete chapter cipher tuple: ${bookSourceId}/${row.chapter_index}`);
    const algorithm = stringValue(row.algorithm, "chapters.algorithm");
    if (algorithm !== "aes-256-gcm") throw new Error(`unsupported chapter algorithm: ${algorithm}`);

    return Object.freeze({
      bookSourceId,
      chapterIndex: row.chapter_index,
      title: stringValue(row.title, "chapters.title"),
      contentHmac: stringValue(row.content_hmac, "chapters.content_hmac"),
      ciphertext,
      iv,
      tag,
      algorithm,
      updatedAt: stringValue(row.updated_at, "chapters.updated_at"),
    });
  }));
};

export const openLegacySnapshot = (input: OpenLegacySnapshotInput): LegacySnapshotReader => {
  if (!input || input.readOnly !== true) throw new Error("legacy snapshot input must be explicitly read-only");
  const initialFingerprint = sha256(input.filePath);
  const db = new DatabaseSync(input.filePath, { readOnly: true });
  try {
    db.exec("PRAGMA query_only = ON");
    validateSchema(db);
    const books = readBooks(db);
    const chapters = readChapters(db);
    let closed = false;
    return {
      fingerprint: () => initialFingerprint,
      books: () => books,
      chapters: (bookSourceId) => Object.freeze(chapters.filter((chapter) => chapter.bookSourceId === bookSourceId)),
      close: () => {
        if (closed) return;
        db.close();
        closed = true;
        if (sha256(input.filePath) !== initialFingerprint) throw new Error("legacy snapshot changed while reading");
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
};
