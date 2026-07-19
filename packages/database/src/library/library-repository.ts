import type { ContentCipher } from "./content-encryption.js";
import type { DatabaseExecutor } from "../db.js";

export function createLibraryRepository(db: DatabaseExecutor, cipher: ContentCipher) {
  return {
    async createBook(input: { title: string; createdBy: string }) {
      return db.insertInto("books").values({ title: input.title, created_by: input.createdBy, status: "active" }).returning(["id", "title", "status", "created_at"]).executeTakeFirstOrThrow();
    },
    async listBooks() {
      const rows = await db.selectFrom("books as b").leftJoin("chapters as c", "c.book_id", "b.id").select(["b.id", "b.title", "b.status", "b.created_at"]).select(({ fn }) => fn.count<number>("c.id").as("chapter_count")).groupBy("b.id").orderBy("b.created_at", "desc").execute();
      return rows.map(row => ({ id: row.id, title: row.title, status: row.status, createdAt: row.created_at, chapterCount: Number(row.chapter_count) }));
    },
    async getBook(id: string) {
      const row = await db.selectFrom("books as b").leftJoin("chapters as c", "c.book_id", "b.id").select(["b.id", "b.title", "b.status", "b.created_at"]).select(({ fn }) => fn.count<number>("c.id").as("chapter_count")).where("b.id", "=", id).groupBy("b.id").executeTakeFirst();
      return row ? { id: row.id, title: row.title, status: row.status, createdAt: row.created_at, chapterCount: Number(row.chapter_count) } : undefined;
    },
    async upsertSource(input: { bookId: string; provider: string; sourceId: string; startChapter: number; endChapter: number }) {
      return db.insertInto("book_sources").values({ book_id: input.bookId, provider: input.provider, source_id: input.sourceId, start_chapter: input.startChapter, end_chapter: input.endChapter }).onConflict(conflict => conflict.column("book_id").doUpdateSet({ provider: input.provider, source_id: input.sourceId, start_chapter: input.startChapter, end_chapter: input.endChapter, updated_at: new Date() })).returningAll().executeTakeFirstOrThrow();
    },
    async insertChapter(input: { bookId: string; chapterIndex: number; title: string; plaintext: string; contentHmac: string; sourceVersion: string }) {
      const encrypted = cipher.encrypt(input.plaintext);
      return db.insertInto("chapters").values({ book_id: input.bookId, chapter_index: input.chapterIndex, title: input.title, content_hmac: input.contentHmac, content_ciphertext: encrypted.ciphertext, content_nonce: encrypted.nonce, content_tag: encrypted.tag, content_key_version: encrypted.keyVersion, source_version: input.sourceVersion }).returning(["id", "book_id", "chapter_index", "title", "source_version", "created_at"]).executeTakeFirstOrThrow();
    },
  };
}
