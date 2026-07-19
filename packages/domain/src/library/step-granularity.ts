export type ChapterStepCandidate = { chapterIndex: number };
export type ChapterStepStatus = {
  chapterIndex: number;
  status: string;
};

export function buildStepCandidates(chapterCount: number): ChapterStepCandidate[] {
  return Array.from({ length: chapterCount }, (_, index) => ({ chapterIndex: index + 1 }));
}

export function retryFailedChapters(steps: readonly ChapterStepStatus[]): number[] {
  return steps.filter((step) => step.status === "failed").map((step) => step.chapterIndex);
}

export function estimateInitialReplayEvents(_chapterCount: number): number {
  return 1;
}

export function compareStepGranularities(chapterCount: number, batchSize: number): {
  chapter: { stepCount: number; maxRepeatedChapters: number };
  fixedBatch: { stepCount: number; maxRepeatedChapters: number };
} {
  return {
    chapter: { stepCount: chapterCount, maxRepeatedChapters: Math.min(chapterCount, 1) },
    fixedBatch: {
      stepCount: Math.ceil(chapterCount / batchSize),
      maxRepeatedChapters: Math.min(chapterCount, batchSize),
    },
  };
}
