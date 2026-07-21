import { describe, expect, it } from "vitest";

import { modeSourcePolicy } from "./mode-policy.js";

describe("modeSourcePolicy", () => {
  it("reads L1 and L2 without reviewing original chapters in fast_index", () => {
    expect(modeSourcePolicy("fast_index", 1_000)).toEqual({
      readsL1: true,
      readsL2: true,
      readsOriginalChapters: false,
      reviewChapterCount: 0,
    });
  });

  it.each([
    [1, 3],
    [301, 4],
    [1_001, 10],
    [10_000, 10],
  ])("keeps the balanced review budget for %i chapters at %i", (chapterCount, expected) => {
    expect(modeSourcePolicy("balanced", chapterCount)).toEqual({
      readsL1: true,
      readsL2: true,
      readsOriginalChapters: true,
      reviewChapterCount: expected,
    });
  });

  it.each([
    [1, 5],
    [167, 6],
    [967, 30],
    [10_000, 30],
  ])("keeps the precision review budget for %i chapters at %i", (chapterCount, expected) => {
    expect(modeSourcePolicy("precision", chapterCount)).toEqual({
      readsL1: true,
      readsL2: true,
      readsOriginalChapters: true,
      reviewChapterCount: expected,
    });
  });

  it("reads every selected original chapter in full_text without index sources", () => {
    expect(modeSourcePolicy("full_text", 237)).toEqual({
      readsL1: false,
      readsL2: false,
      readsOriginalChapters: true,
      reviewChapterCount: 237,
    });
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects invalid chapter count %s", (chapterCount) => {
    expect(() => modeSourcePolicy("balanced", chapterCount)).toThrow("chapterCount");
  });
});
