import { normalizeDifyOutput } from "@novel-analysis/contracts";

export const normalizeChapterImportOutput = (raw: unknown) => normalizeDifyOutput("chapter-import", raw);
export const normalizeL1IndexOutput = (raw: unknown) => normalizeDifyOutput("l1-index", raw);
export const normalizeL2IndexOutput = (raw: unknown) => normalizeDifyOutput("l2-index", raw);
