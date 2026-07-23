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
