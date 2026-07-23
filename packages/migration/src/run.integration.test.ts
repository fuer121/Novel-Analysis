import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { access, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createContentCipher } from "@novel-analysis/database";
import {
  createDisposablePostgres,
  type DisposablePostgres,
} from "../../database/src/testing/postgres.js";
import {
  createTwoBookLegacySnapshot,
  SYNTHETIC_LEGACY_MASTER_KEY,
} from "../../../test/phase5/fixtures/create-legacy-snapshot.js";
import type { TargetWriter } from "./contracts.js";
import { openLegacySnapshot } from "./legacy-reader.js";
import { createMigrationRunner, runMigration } from "./run.js";
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
    ["content-digest", async (postgres: DisposablePostgres) => {
      await postgres.db.updateTable("chapters").set({ source_version: "0".repeat(64) }).execute();
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
    });

    const error = await runner(context.input).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MigrationHardFailure);
    expect((error as MigrationHardFailure).codes).toContain(expectedCode);
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

  test("fails nonzero mid-book and does not publish a manifest", async () => {
    const context = await setupRun();
    const runner = createMigrationRunner({
      openSource: openLegacySnapshot,
      createWriter: async (input) => {
        const writer = await createTargetWriter(input);
        let calls = 0;
        return {
          async writeBook(book, chapters) {
            calls += 1;
            if (calls === 2) throw new Error("forced_mid_book_failure");
            return writer.writeBook(book, chapters);
          },
        } satisfies TargetWriter;
      },
      validate: vi.fn(validateMigration),
    });

    await expect(runner(context.input)).rejects.toThrow("forced_mid_book_failure");
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
  return {
    postgres,
    ownerId: owner.id,
    sourcePath,
    manifestPath,
    input: {
      sourcePath,
      database: postgres.db,
      createdBy: owner.id,
      oldMasterKey: SYNTHETIC_LEGACY_MASTER_KEY,
      targetCipher: createContentCipher({
        activeKeyVersion: "migration-v1",
        keys: { "migration-v1": targetKey },
      }),
      targetHmacKey,
      manifestPath,
      targetSchemaVersion: "phase5-test",
    },
  };
}
