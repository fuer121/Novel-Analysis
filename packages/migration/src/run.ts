import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, open, rename, unlink } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import type { ContentCipher, DatabaseConnection } from "@novel-analysis/database";
import type {
  LegacySnapshotReader,
  MigrationManifest,
  TargetWriter,
} from "./contracts.js";
import {
  openLegacySnapshot,
  type OpenLegacySnapshotInput,
} from "./legacy-reader.js";
import { createMigrationManifest } from "./manifest.js";
import {
  createTargetWriter,
  type CreateTargetWriterInput,
} from "./target-writer.js";
import {
  MigrationHardFailure,
  validateMigration,
  type ValidationSummary,
  type ValidateMigrationInput,
} from "./validate.js";

export type MigrationRunResult = Readonly<{
  status: "passed";
  elapsedMs: number;
  manifestPath: string;
  books: number;
  chapters: number;
  validations: readonly ValidationSummary[];
}>;

export type RunMigrationInput = Readonly<{
  sourcePath: string;
  database: DatabaseConnection;
  createdBy: string;
  oldMasterKey: Buffer;
  targetCipher: ContentCipher;
  targetHmacKey: Buffer;
  manifestPath: string;
  targetSchemaVersion: string;
}>;

const assertManifestAbsent = async (manifestPath: string): Promise<void> => {
  try {
    await access(manifestPath, constants.F_OK);
    throw new Error("manifest_exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
};

const writeManifestAtomically = async (
  manifestPath: string,
  manifest: MigrationManifest,
): Promise<void> => {
  const temporaryPath = join(
    dirname(manifestPath),
    `.${basename(manifestPath)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  let ownsTemporary = false;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    ownsTemporary = true;
    try {
      await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertManifestAbsent(manifestPath);
    await rename(temporaryPath, manifestPath);
    ownsTemporary = false;
  } finally {
    if (ownsTemporary) await unlink(temporaryPath).catch(() => undefined);
  }
};

type MigrationRunnerDependencies = Readonly<{
  openSource(input: OpenLegacySnapshotInput): LegacySnapshotReader;
  createWriter(input: CreateTargetWriterInput): Promise<TargetWriter>;
  validate(input: ValidateMigrationInput): Promise<readonly ValidationSummary[]>;
}>;

export const createMigrationRunner = (
  dependencies: MigrationRunnerDependencies,
) => async (input: RunMigrationInput): Promise<MigrationRunResult> => {
  const startedAt = new Date();
  const started = performance.now();
  await assertManifestAbsent(input.manifestPath);
  const source = dependencies.openSource({ filePath: input.sourcePath, readOnly: true });
  let sourceClosed = false;
  const closeSource = (): void => {
    if (sourceClosed) return;
    sourceClosed = true;
    try {
      source.close();
    } catch {
      throw new MigrationHardFailure(["source-integrity"]);
    }
  };
  try {
    const books = source.books();
    const chapterCount = books.reduce(
      (count, book) => count + source.chapters(book.sourceId).length,
      0,
    );
    const writer = await dependencies.createWriter({
      database: input.database,
      createdBy: input.createdBy,
      sourceFingerprint: source.fingerprint(),
      oldMasterKey: input.oldMasterKey,
      targetCipher: input.targetCipher,
      targetHmacKey: input.targetHmacKey,
    });
    const bookManifests = [];
    for (const book of books) {
      bookManifests.push(await writer.writeBook(book, source.chapters(book.sourceId)));
    }
    const validations = await dependencies.validate({
      database: input.database,
      source,
      oldMasterKey: input.oldMasterKey,
      targetCipher: input.targetCipher,
      targetHmacKey: input.targetHmacKey,
    });
    closeSource();
    const completedAt = new Date();
    await writeManifestAtomically(input.manifestPath, createMigrationManifest({
      sourceFingerprint: source.fingerprint(),
      targetSchemaVersion: input.targetSchemaVersion,
      startedAt,
      completedAt,
      books: bookManifests,
    }));
    return Object.freeze({
      status: "passed",
      elapsedMs: Math.max(0, performance.now() - started),
      manifestPath: input.manifestPath,
      books: books.length,
      chapters: chapterCount,
      validations,
    });
  } finally {
    closeSource();
  }
};

export const runMigration = createMigrationRunner({
  openSource: openLegacySnapshot,
  createWriter: createTargetWriter,
  validate: validateMigration,
});
