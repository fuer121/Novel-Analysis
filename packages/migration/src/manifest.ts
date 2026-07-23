import type {
  MigrationBookManifest,
  MigrationManifest,
} from "./contracts.js";

export type CreateMigrationManifestInput = Readonly<{
  sourceFingerprint: string;
  targetSchemaVersion: string;
  startedAt: Date;
  completedAt: Date;
  books: readonly MigrationBookManifest[];
}>;

export function createMigrationManifest(
  input: CreateMigrationManifestInput,
): MigrationManifest {
  return Object.freeze({
    manifestVersion: "phase5-v1",
    sourceFingerprint: input.sourceFingerprint,
    targetSchemaVersion: input.targetSchemaVersion,
    startedAt: input.startedAt.toISOString(),
    completedAt: input.completedAt.toISOString(),
    books: Object.freeze(input.books.map((book) => Object.freeze({ ...book }))),
  });
}
