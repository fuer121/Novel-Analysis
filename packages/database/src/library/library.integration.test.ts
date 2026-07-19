import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { sql } from "kysely";

import { createContentCipher } from "./content-encryption.js";
import { createLibraryRepository } from "./library-repository.js";
import { createDisposablePostgres, type DisposablePostgres } from "../testing/postgres.js";

describe("library persistence", () => {
  let postgres: DisposablePostgres;
  beforeAll(async () => { postgres = await createDisposablePostgres(); });
  afterAll(async () => { await postgres?.destroy(); });

  test("migration creates the approved tables without plaintext columns", async () => {
    const tables = ["books", "book_sources", "chapters", "prompt_versions", "workflow_versions", "index_groups", "l1_indexes", "l2_chapter_statuses", "l2_facts", "l2_subjects"];
    const result = await sql<{ table_name: string }>`select table_name from information_schema.tables where table_schema = 'public' and table_name in (${sql.join(tables)})`.execute(postgres.db);
    expect(result.rows.map((row) => row.table_name).sort()).toEqual([...tables].sort());
    const columns = await sql<{ column_name: string }>`select column_name from information_schema.columns where table_schema = 'public' and table_name in ('chapters', 'l2_facts')`.execute(postgres.db);
    expect(columns.rows.map((row) => row.column_name)).not.toEqual(expect.arrayContaining(["body", "content", "fact_body"]));
  });

  test("AES-256-GCM rejects invalid keys, unknown versions and tampering", () => {
    expect(() => createContentCipher({ activeKeyVersion: "v1", keys: { v1: randomBytes(31) } })).toThrow(/32 bytes/);
    const cipher = createContentCipher({ activeKeyVersion: "v1", keys: { v1: randomBytes(32) } });
    const encrypted = cipher.encrypt("private chapter");
    expect(cipher.decrypt(encrypted)).toBe("private chapter");
    expect(() => cipher.decrypt({ ...encrypted, keyVersion: "v2" })).toThrow(/Unknown key version/);
    const tag = Buffer.from(encrypted.tag); tag[0] ^= 1;
    expect(() => cipher.decrypt({ ...encrypted, tag })).toThrow();
  });

  test("content cipher snapshots mutable key configuration and redacts unknown versions", () => {
    const key = randomBytes(32);
    const replacement = randomBytes(32);
    const config = { activeKeyVersion: "v1", keys: { v1: key, v2: replacement } };
    const cipher = createContentCipher(config);
    const encrypted = cipher.encrypt("snapshot");
    config.activeKeyVersion = "v2";
    config.keys.v1 = replacement;
    key.fill(0);
    replacement.fill(1);
    expect(cipher.decrypt(encrypted)).toBe("snapshot");
    expect(cipher.encrypt("still-v1").keyVersion).toBe("v1");
    expect(() => cipher.decrypt({ ...encrypted, keyVersion: "database-secret-version" })).toThrowError("Unknown key version");
  });

  test("creates books, sources and encrypted chapters without logging plaintext", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const cipher = createContentCipher({ activeKeyVersion: "v1", keys: { v1: randomBytes(32) } });
    const repository = createLibraryRepository(postgres.db, cipher);
    const actor = await postgres.db.insertInto("users").values({ display_name: "Owner", role: "member", status: "active" }).returning("id").executeTakeFirstOrThrow();
    const book = await repository.createBook({ title: "Novel", createdBy: actor.id });
    await repository.upsertSource({ bookId: book.id, provider: "dify", sourceId: "source-1", startChapter: 1, endChapter: 2 });
    const sentinel = `plaintext-${randomUUID()}`;
    await repository.insertChapter({ bookId: book.id, chapterIndex: 1, title: "One", plaintext: sentinel, contentHmac: "hmac", sourceVersion: "v1" });
    expect((await repository.listBooks())[0]?.chapterCount).toBe(1);
    expect((await repository.getBook(book.id))?.title).toBe("Novel");
    const rows = await sql<Record<string, unknown>>`select * from chapters where book_id = ${book.id}`.execute(postgres.db);
    expect(JSON.stringify(rows.rows)).not.toContain(sentinel);
    expect(JSON.stringify(log.mock.calls)).not.toContain(sentinel);
    log.mockRestore();
  });
});
