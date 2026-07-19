import { describe, expect, it } from "vitest";

import { buildStepCandidates, compareStepGranularities, estimateInitialReplayEvents, retryFailedChapters } from "./step-granularity.js";

describe("step granularity candidates", () => {
  it.each([3, 100, 3000])("creates one independently retryable step for each of %i chapters", (count) => {
    const steps = buildStepCandidates(count);
    expect(steps).toHaveLength(count);
    expect(new Set(steps.map((step) => step.chapterIndex)).size).toBe(count);
  });

  it("retries exactly one failed chapter", () => {
    expect(retryFailedChapters([
      { chapterIndex: 1, status: "completed" },
      { chapterIndex: 2, status: "failed" },
      { chapterIndex: 3, status: "completed" },
    ])).toEqual([2]);
  });

  it("keeps initial SSE replay bounded independently of chapter count", () => {
    expect(estimateInitialReplayEvents(3000)).toBeLessThan(10);
  });

  it.each([3, 100, 3000])("compares chapter and fixed-batch candidates for %i chapters", (chapterCount) => {
    expect(compareStepGranularities(chapterCount, 100)).toEqual({
      chapter: { stepCount: chapterCount, maxRepeatedChapters: 1 },
      fixedBatch: { stepCount: Math.ceil(chapterCount / 100), maxRepeatedChapters: Math.min(chapterCount, 100) },
    });
  });
});
