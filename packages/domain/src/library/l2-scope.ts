export type L2ScopeMode = "all" | "missing" | "retry_failed";
export type L2ChapterStatus = "fresh" | "missing" | "failed" | "stale";

export type L2ChapterIndexState = {
  chapterId: string;
  chapterIndex: number;
  status: L2ChapterStatus;
};

export type L2ScopeSkip = {
  chapterIndex: number;
  reason: L2ChapterStatus | "outside-range";
};

export function selectL2Scope(input: {
  mode: L2ScopeMode;
  force: boolean;
  startChapter: number;
  endChapter: number;
  chapters: L2ChapterIndexState[];
}): { execute: number[]; skip: L2ScopeSkip[] } {
  if (!Number.isSafeInteger(input.startChapter) || !Number.isSafeInteger(input.endChapter)
    || input.startChapter <= 0 || input.endChapter < input.startChapter) {
    throw new Error("Invalid L2 scope range");
  }

  const ordered = [...input.chapters].sort((left, right) => left.chapterIndex - right.chapterIndex);
  if (ordered.some((chapter, index) => index > 0 && chapter.chapterIndex === ordered[index - 1]?.chapterIndex)) {
    throw new Error("Duplicate L2 chapter index");
  }

  const execute: number[] = [];
  const skip: L2ScopeSkip[] = [];
  for (const chapter of ordered) {
    const inRange = chapter.chapterIndex >= input.startChapter && chapter.chapterIndex <= input.endChapter;
    const selected = inRange && (
      input.mode === "all"
      || (input.mode === "missing" && chapter.status === "missing")
      || (input.mode === "retry_failed" && chapter.status === "failed")
    );
    if (selected) execute.push(chapter.chapterIndex);
    else skip.push({ chapterIndex: chapter.chapterIndex, reason: inRange ? chapter.status : "outside-range" });
  }
  return { execute, skip };
}
