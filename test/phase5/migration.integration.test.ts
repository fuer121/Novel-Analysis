import { createHash, randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createDisposablePostgres,
  type DisposablePostgres,
} from "../../packages/database/src/testing/postgres.js";
import { executeMigrationCli } from "../../packages/migration/src/cli.js";
import {
  createTwoBookLegacySnapshot,
  SYNTHETIC_LEGACY_MASTER_KEY,
} from "./fixtures/create-legacy-snapshot.js";

const disposables: DisposablePostgres[] = [];

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((postgres) => postgres.destroy()));
});

describe("Phase 5 migration CLI", () => {
  test("migrates a synthetic two-book snapshot using only explicit arguments and key files", async () => {
    const setup = await setupCli();
    const stdout = vi.fn();
    const stderr = vi.fn();

    const exitCode = await executeMigrationCli(setup.args, { stdout, stderr });

    expect(exitCode).toBe(0);
    expect(stderr).not.toHaveBeenCalled();
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"status":"passed"'));
    expect((await stat(setup.manifestPath)).mode & 0o777).toBe(0o600);
    const manifest = JSON.parse(await readFile(setup.manifestPath, "utf8"));
    expect(manifest.books).toHaveLength(2);
    expect(await setup.postgres.db.selectFrom("books").selectAll().execute()).toHaveLength(2);
    expect(await setup.postgres.db.selectFrom("chapters").selectAll().execute()).toHaveLength(4);
  });

  test("returns nonzero and preserves an existing manifest", async () => {
    const setup = await setupCli();
    await writeFile(setup.manifestPath, "immutable", { mode: 0o600 });
    const stderr = vi.fn();

    const exitCode = await executeMigrationCli(setup.args, { stderr, stdout: vi.fn() });

    expect(exitCode).toBe(1);
    expect(stderr).toHaveBeenCalledWith("migration_failed:manifest_exists\n");
    expect(await readFile(setup.manifestPath, "utf8")).toBe("immutable");
    await expect(access(`${setup.manifestPath}.tmp`)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function setupCli() {
  const directory = await mkdtemp(join(tmpdir(), "phase5-cli-"));
  const sourcePath = join(directory, "source.sqlite");
  const manifestPath = join(directory, "manifest.json");
  const oldKeyFile = join(directory, "old.key");
  const targetKeyFile = join(directory, "target.key");
  const targetHmacKeyFile = join(directory, "target-hmac.key");
  createTwoBookLegacySnapshot(sourcePath);
  await Promise.all([
    writeFile(oldKeyFile, SYNTHETIC_LEGACY_MASTER_KEY, { mode: 0o600 }),
    writeFile(targetKeyFile, createHash("sha256").update(`target-${randomUUID()}`).digest(), { mode: 0o600 }),
    writeFile(targetHmacKeyFile, createHash("sha256").update(`hmac-${randomUUID()}`).digest(), { mode: 0o600 }),
  ]);
  const postgres = await createDisposablePostgres();
  disposables.push(postgres);
  await postgres.db.insertInto("users").values({
    display_name: "Migration Owner", role: "admin", status: "active",
  }).execute();
  return {
    postgres,
    manifestPath,
    args: [
      "--source", sourcePath,
      "--database-url", postgres.databaseUrl,
      "--old-key-file", oldKeyFile,
      "--target-key-file", targetKeyFile,
      "--target-hmac-key-file", targetHmacKeyFile,
      "--manifest", manifestPath,
    ],
  };
}
