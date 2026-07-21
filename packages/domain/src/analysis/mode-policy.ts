import type { AnalysisMode } from "@novel-analysis/contracts";

export interface ModeSourcePolicy {
  readsL1: boolean;
  readsL2: boolean;
  readsOriginalChapters: boolean;
  reviewChapterCount: number;
}

export function modeSourcePolicy(mode: AnalysisMode, chapterCount: number): ModeSourcePolicy {
  if (!Number.isSafeInteger(chapterCount) || chapterCount < 1) {
    throw new Error("chapterCount must be a positive integer");
  }

  switch (mode) {
    case "fast_index":
      return { readsL1: true, readsL2: true, readsOriginalChapters: false, reviewChapterCount: 0 };
    case "balanced":
      return {
        readsL1: true,
        readsL2: true,
        readsOriginalChapters: true,
        reviewChapterCount: Math.min(10, Math.max(3, Math.ceil(chapterCount * 0.01))),
      };
    case "precision":
      return {
        readsL1: true,
        readsL2: true,
        readsOriginalChapters: true,
        reviewChapterCount: Math.min(30, Math.max(5, Math.ceil(chapterCount * 0.03))),
      };
    case "full_text":
      return {
        readsL1: false,
        readsL2: false,
        readsOriginalChapters: true,
        reviewChapterCount: chapterCount,
      };
  }
}
