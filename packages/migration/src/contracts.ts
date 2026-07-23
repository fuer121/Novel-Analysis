export type LegacyBook = Readonly<{
  sourceId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}>;

export type LegacyChapter = Readonly<{
  bookSourceId: string;
  chapterIndex: number;
  title: string;
  contentHmac: string;
  ciphertext: string;
  iv: string;
  tag: string;
  algorithm: "aes-256-gcm";
  updatedAt: string;
}>;

export interface LegacySnapshotReader {
  fingerprint(): string;
  books(): readonly LegacyBook[];
  chapters(bookSourceId: string): readonly LegacyChapter[];
  close(): void;
}

export type MigrationBookManifest = Readonly<{
  sourceIdHash: string;
  targetId: string;
  chapterCount: number;
  contentDigest: string;
  durationMs: number;
  status: "completed";
}>;

export type MigrationManifest = Readonly<{
  manifestVersion: "phase5-v1";
  sourceFingerprint: string;
  targetSchemaVersion: string;
  startedAt: string;
  completedAt: string;
  books: readonly MigrationBookManifest[];
}>;

export interface TargetWriter {
  writeBook(
    book: LegacyBook,
    chapters: readonly LegacyChapter[],
  ): Promise<MigrationBookManifest>;
}
