import { createHash, createHmac, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  access,
  link,
  mkdtemp,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createContentCipher, sql } from "@novel-analysis/database";
import {
  createDisposablePostgres,
  type DisposablePostgres,
} from "../../database/src/testing/postgres.js";
import {
  createTwoBookLegacySnapshot,
  SYNTHETIC_LEGACY_MASTER_KEY,
} from "../../../test/phase5/fixtures/create-legacy-snapshot.js";
import { openLegacySnapshot } from "./legacy-reader.js";
import {
  createManifestPublisher,
  createMigrationRunner,
  runMigration,
} from "./run.js";
import { createTargetWriter } from "./target-writer.js";
import { MigrationHardFailure, validateMigration } from "./validate.js";

const disposables: DisposablePostgres[] = [];

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((postgres) => postgres.destroy()));
});

describe("migration orchestration", () => {
  test("migrates two books, validates the complete target, and atomically publishes a private manifest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "phase5-migration-"));
    const sourcePath = join(directory, "source.sqlite");
    const manifestPath = join(directory, "manifest.json");
    createTwoBookLegacySnapshot(sourcePath);
    const postgres = await createDisposablePostgres();
    disposables.push(postgres);
    const owner = await postgres.db
      .insertInto("users")
      .values({ display_name: "Migration Owner", role: "admin", status: "active" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const targetKey = createHash("sha256").update(randomUUID()).digest();
    const targetHmacKey = createHash("sha256").update(randomUUID()).digest();
    const targetCipher = createContentCipher({
      activeKeyVersion: "migration-v1",
      keys: { "migration-v1": targetKey },
    });

    const result = await runMigration({
      sourcePath,
      database: postgres.db,
      createdBy: owner.id,
      oldMasterKey: SYNTHETIC_LEGACY_MASTER_KEY,
      targetCipher,
      targetHmacKey,
      manifestPath,
      targetSchemaVersion: "phase5-test",
    });

    expect(result).toMatchObject({
      status: "passed",
      manifestPath,
      books: 2,
      chapters: 4,
    });
    expect(result.validations.map((item) => item.name)).toEqual([
      "book-count",
      "chapter-count",
      "metadata",
      "source-integrity",
      "content-digest",
      "target-decrypt",
      "target-hmac",
      "scope-exclusion",
    ]);
    expect(result.validations.every((item) => item.passed)).toBe(true);
    expect((await stat(manifestPath)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(manifestPath, "utf8"))).toMatchObject({
      manifestVersion: "phase5-v1",
      sourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      books: [
        { status: "completed", chapterCount: 2 },
        { status: "completed", chapterCount: 2 },
      ],
    });
  });

  test.each([
    ["book-count", async (postgres: DisposablePostgres) => {
      const book = await postgres.db.selectFrom("books").select("id").orderBy("id").executeTakeFirstOrThrow();
      await postgres.db.deleteFrom("chapters").where("book_id", "=", book.id).execute();
      await postgres.db.deleteFrom("book_sources").where("book_id", "=", book.id).execute();
      await postgres.db.deleteFrom("books").where("id", "=", book.id).execute();
    }],
    ["metadata", async (postgres: DisposablePostgres) => {
      await postgres.db.updateTable("books").set({ title: "Drifted title" }).execute();
    }],
    ["chapter-count", async (postgres: DisposablePostgres) => {
      const chapter = await postgres.db.selectFrom("chapters").select("id").orderBy("id").executeTakeFirstOrThrow();
      await postgres.db.deleteFrom("chapters").where("id", "=", chapter.id).execute();
    }],
    ["target-decrypt", async (postgres: DisposablePostgres) => {
      await postgres.db.updateTable("chapters").set({ content_tag: Buffer.alloc(16) }).execute();
    }],
    ["target-hmac", async (postgres: DisposablePostgres) => {
      await postgres.db.updateTable("chapters").set({ content_hmac: "0".repeat(64) }).execute();
    }],
    ["scope-exclusion", async (postgres: DisposablePostgres) => {
      await postgres.db.insertInto("audit_logs").values({
        actor_user_id: null,
        action: "synthetic-drift",
        target_type: "migration-test",
        target_id: randomUUID(),
        metadata: {},
      }).execute();
    }],
  ])("fails closed when %s validation detects drift", async (expectedCode, corrupt) => {
    const context = await setupRun();
    const runner = createMigrationRunner({
      openSource: openLegacySnapshot,
      createWriter: async (input) => {
        const writer = await createTargetWriter(input);
        let completed = 0;
        return {
          async writeBook(book, chapters) {
            const result = await writer.writeBook(book, chapters);
            completed += 1;
            if (completed === 2) await corrupt(context.postgres);
            return result;
          },
        };
      },
      validate: validateMigration,
      publishManifest: createManifestPublisher(),
    });

    const error = await runner(context.input).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MigrationHardFailure);
    expect((error as MigrationHardFailure).codes).toContain(expectedCode);
    await expect(access(context.manifestPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("detects normalized target content drift while decrypt and HMAC remain valid", async () => {
    const context = await setupRun();
    const runner = createMigrationRunner({
      openSource: openLegacySnapshot,
      createWriter: async (input) => {
        const writer = await createTargetWriter(input);
        let completed = 0;
        return {
          async writeBook(book, chapters) {
            const result = await writer.writeBook(book, chapters);
            completed += 1;
            if (completed === 2) {
              const plaintext = "Different normalized target content\n";
              const encrypted = context.targetCipher.encrypt(plaintext);
              const chapter = await context.postgres.db
                .selectFrom("chapters")
                .select("id")
                .orderBy("id")
                .executeTakeFirstOrThrow();
              await context.postgres.db.updateTable("chapters").set({
                content_ciphertext: encrypted.ciphertext,
                content_nonce: encrypted.nonce,
                content_tag: encrypted.tag,
                content_key_version: encrypted.keyVersion,
                content_hmac: createHmac("sha256", context.targetHmacKey)
                  .update(plaintext, "utf8")
                  .digest("hex"),
              }).where("id", "=", chapter.id).execute();
            }
            return result;
          },
        };
      },
      validate: validateMigration,
      publishManifest: createManifestPublisher(),
    });

    const error = await runner(context.input).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MigrationHardFailure);
    expect((error as MigrationHardFailure).codes).toEqual(["content-digest"]);
    await expect(access(context.manifestPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test.each([
    ["count", "INSERT INTO books VALUES ('late-book', 'Late', '2026-03-01', '2026-03-01')"],
    ["title", "UPDATE books SET book_name = 'Changed during run' WHERE book_id = 'book-source-2'"],
    ["content", "UPDATE chapters SET ciphertext = 'changed' WHERE book_id = 'book-source-2' AND chapter_index = 1"],
  ])("fails closed when source %s changes during migration", async (_kind, mutation) => {
    const context = await setupRun();
    const runner = createMigrationRunner({
      openSource: openLegacySnapshot,
      createWriter: async (input) => {
        const writer = await createTargetWriter(input);
        let completed = 0;
        return {
          async writeBook(book, chapters) {
            const result = await writer.writeBook(book, chapters);
            completed += 1;
            if (completed === 1) {
              const source = new DatabaseSync(context.sourcePath);
              source.exec(mutation);
              source.close();
            }
            return result;
          },
        };
      },
      validate: validateMigration,
      publishManifest: createManifestPublisher(),
    });

    const error = await runner(context.input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MigrationHardFailure);
    expect((error as MigrationHardFailure).codes).toEqual(["source-integrity"]);
    await expect(access(context.manifestPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects duplicate source chapters without publishing a manifest", async () => {
    const context = await setupRun();
    const source = new DatabaseSync(context.sourcePath);
    source.exec(`
      INSERT INTO chapters
      SELECT book_id, chapter_index, title, content_hmac, ciphertext, iv, tag, algorithm, updated_at
      FROM chapters
      WHERE book_id = 'book-source-1' AND chapter_index = 1
    `);
    source.close();

    await expect(runMigration(context.input)).rejects.toThrow("duplicate chapter position");
    await expect(access(context.manifestPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects a non-empty target without deleting existing data", async () => {
    const context = await setupRun();
    await context.postgres.db.insertInto("books").values({
      title: "Existing", created_by: context.ownerId, status: "active",
    }).execute();

    await expect(runMigration(context.input)).rejects.toThrow("target_not_empty");
    expect(await context.postgres.db.selectFrom("books").select("title").execute()).toEqual([{ title: "Existing" }]);
    await expect(access(context.manifestPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects an existing manifest without touching it", async () => {
    const context = await setupRun();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(context.manifestPath, "existing", { mode: 0o600 });

    await expect(runMigration(context.input)).rejects.toThrow("manifest_exists");
    expect(await readFile(context.manifestPath, "utf8")).toBe("existing");
  });

  test("does not overwrite a manifest created at the publication boundary", async () => {
    const context = await setupRun();
    const sentinel = "user-created-manifest";
    const publisher = createManifestPublisher({
      async link(temporaryPath, manifestPath) {
        await writeFile(manifestPath, sentinel, { mode: 0o600 });
        return link(temporaryPath, manifestPath);
      },
    });
    const runner = createMigrationRunner({
      openSource: openLegacySnapshot,
      createWriter: createTargetWriter,
      validate: validateMigration,
      publishManifest: publisher,
    });

    await expect(runner(context.input)).rejects.toThrow("manifest_exists");
    expect(await readFile(context.manifestPath, "utf8")).toBe(sentinel);
    expect((await readdir(dirname(context.manifestPath)))
      .filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  test("rolls back a book when its second chapter insert fails inside the transaction", async () => {
    const context = await setupRun();
    try {
      await sql.raw(`
        CREATE FUNCTION phase5_fail_second_chapter() RETURNS trigger AS $$
        BEGIN
          IF NEW.chapter_index = 2
            AND (SELECT title FROM books WHERE id = NEW.book_id) = 'Synthetic Book Two'
          THEN
            RAISE EXCEPTION 'forced_mid_book_failure';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER phase5_fail_second_chapter
        BEFORE INSERT ON chapters
        FOR EACH ROW EXECUTE FUNCTION phase5_fail_second_chapter()
      `).execute(context.postgres.db);
      await expect(runMigration(context.input)).rejects.toThrow("forced_mid_book_failure");
    } finally {
      await sql.raw(`
        DROP TRIGGER IF EXISTS phase5_fail_second_chapter ON chapters;
        DROP FUNCTION IF EXISTS phase5_fail_second_chapter()
      `).execute(context.postgres.db);
    }

    expect(await context.postgres.db.selectFrom("books").select("title").execute())
      .toEqual([{ title: "Synthetic Book" }]);
    expect(await context.postgres.db.selectFrom("book_sources").selectAll().execute())
      .toHaveLength(1);
    expect(await context.postgres.db.selectFrom("chapters").selectAll().execute())
      .toHaveLength(2);
    await expect(access(context.manifestPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function setupRun() {
  const directory = await mkdtemp(join(tmpdir(), "phase5-migration-"));
  const sourcePath = join(directory, "source.sqlite");
  const manifestPath = join(directory, "manifest.json");
  createTwoBookLegacySnapshot(sourcePath);
  const postgres = await createDisposablePostgres();
  disposables.push(postgres);
  const owner = await postgres.db
    .insertInto("users")
    .values({ display_name: "Migration Owner", role: "admin", status: "active" })
    .returning("id")
    .executeTakeFirstOrThrow();
  const targetKey = createHash("sha256").update(randomUUID()).digest();
  const targetHmacKey = createHash("sha256").update(randomUUID()).digest();
  const targetCipher = createContentCipher({
    activeKeyVersion: "migration-v1",
    keys: { "migration-v1": targetKey },
  });
  return {
    postgres,
    ownerId: owner.id,
    sourcePath,
    manifestPath,
    targetCipher,
    targetHmacKey,
    input: {
      sourcePath,
      database: postgres.db,
      createdBy: owner.id,
      oldMasterKey: SYNTHETIC_LEGACY_MASTER_KEY,
      targetCipher,
      targetHmacKey,
      manifestPath,
      targetSchemaVersion: "phase5-test",
    },
  };
}
