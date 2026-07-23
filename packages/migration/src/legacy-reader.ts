import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
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

const nonemptyString = (value: SQLInputValue, field: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`invalid legacy value: ${field}`);
  return value;
};

const assertNoSidecars = (filePath: string): void => {
  for (const suffix of ["-wal", "-shm"]) {
    try {
      if (statSync(`${filePath}${suffix}`).size > 0) throw new Error(`nonempty SQLite sidecar: ${filePath}${suffix}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
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

const readBooks = (db: DatabaseSync): readonly LegacyBook[] => {
  const identities = new Set<string>();
  return Object.freeze(db.prepare("SELECT book_id, book_name, created_at, updated_at FROM books ORDER BY book_id").all().map((row) => {
    const sourceId = nonemptyString(row.book_id, "books.book_id");
    if (identities.has(sourceId)) throw new Error(`duplicate book identity: ${sourceId}`);
    identities.add(sourceId);
    return Object.freeze({
      sourceId,
      title: nonemptyString(row.book_name, "books.book_name"),
      createdAt: nonemptyString(row.created_at, "books.created_at"),
      updatedAt: nonemptyString(row.updated_at, "books.updated_at"),
    });
  }));
};

const readChapters = (db: DatabaseSync, bookIds: ReadonlySet<string>): readonly LegacyChapter[] => {
  const rows = db.prepare(`
    SELECT book_id, chapter_index, title, content_hmac, ciphertext, iv, tag, algorithm, updated_at
    FROM chapters
    ORDER BY book_id, chapter_index
  `).all();
  const positions = new Set<string>();
  return Object.freeze(rows.map((row) => {
    const bookSourceId = nonemptyString(row.book_id, "chapters.book_id");
    if (!bookIds.has(bookSourceId)) throw new Error(`orphan chapter: ${bookSourceId}`);
    if (typeof row.chapter_index !== "number" || !Number.isSafeInteger(row.chapter_index) || row.chapter_index <= 0) {
      throw new Error("invalid legacy value: chapters.chapter_index");
    }
    const position = `${bookSourceId}\0${row.chapter_index}`;
    if (positions.has(position)) throw new Error(`duplicate chapter position: ${bookSourceId}/${row.chapter_index}`);
    positions.add(position);

    if (typeof row.ciphertext !== "string" || !row.ciphertext.trim()
      || typeof row.iv !== "string" || !row.iv.trim()
      || typeof row.tag !== "string" || !row.tag.trim()) {
      throw new Error(`incomplete chapter cipher tuple: ${bookSourceId}/${row.chapter_index}`);
    }
    const ciphertext = row.ciphertext;
    const iv = row.iv;
    const tag = row.tag;
    const algorithm = nonemptyString(row.algorithm, "chapters.algorithm");
    if (algorithm !== "aes-256-gcm") throw new Error(`unsupported chapter algorithm: ${algorithm}`);

    return Object.freeze({
      bookSourceId,
      chapterIndex: row.chapter_index,
      title: nonemptyString(row.title, "chapters.title"),
      contentHmac: nonemptyString(row.content_hmac, "chapters.content_hmac"),
      ciphertext,
      iv,
      tag,
      algorithm,
      updatedAt: nonemptyString(row.updated_at, "chapters.updated_at"),
    });
  }));
};

type OpenDatabase = (filePath: string, options: { readOnly: true }) => DatabaseSync;

const defaultOpenDatabase: OpenDatabase = (filePath, options) => new DatabaseSync(filePath, options);

export const createLegacySnapshotOpener = (openDatabase: OpenDatabase = defaultOpenDatabase) =>
  (input: OpenLegacySnapshotInput): LegacySnapshotReader => {
    if (!input || input.readOnly !== true) throw new Error("legacy snapshot input must be explicitly read-only");
    assertNoSidecars(input.filePath);
    const initialFingerprint = sha256(input.filePath);
    const db = openDatabase(input.filePath, { readOnly: true });
    try {
      db.exec("PRAGMA query_only = ON");
      assertNoSidecars(input.filePath);
      validateSchema(db);
      const books = readBooks(db);
      const chapters = readChapters(db, new Set(books.map((book) => book.sourceId)));
      let closed = false;
      return {
        fingerprint: () => initialFingerprint,
        books: () => books,
        chapters: (bookSourceId) => Object.freeze(chapters.filter((chapter) => chapter.bookSourceId === bookSourceId)),
        close: () => {
          if (closed) return;
          db.close();
          closed = true;
          let sidecarError: unknown;
          try {
            assertNoSidecars(input.filePath);
          } catch (error) {
            sidecarError = error;
          }
          const sourceChanged = sha256(input.filePath) !== initialFingerprint;
          if (sidecarError) throw sidecarError;
          if (sourceChanged) throw new Error("legacy snapshot changed while reading");
        },
      };
    } catch (error) {
      db.close();
      throw error;
    }
  };

export const openLegacySnapshot = createLegacySnapshotOpener();
