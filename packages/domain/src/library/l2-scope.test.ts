import { describe, expect, test } from "vitest";

import { selectL2Scope, type L2ChapterIndexState, type L2ScopeMode } from "./l2-scope.js";

const modes: L2ScopeMode[] = ["all", "missing", "retry_failed"];
const forceValues = [false, true];
const states: Array<L2ChapterIndexState["status"] | "outside-range"> = [
  "fresh",
  "missing",
  "failed",
  "stale",
  "outside-range",
];

function expectedSelected(mode: L2ScopeMode, status: (typeof states)[number]): boolean {
  if (status === "outside-range") return false;
  if (mode === "all") return true;
  if (mode === "missing") return status === "missing";
  return status === "failed";
}

describe("selectL2Scope", () => {
  test.each(modes.flatMap((mode) => forceValues.flatMap((force) => states.map((status) => ({ mode, force, status }))))) (
    "$mode force=$force status=$status",
    ({ mode, force, status }) => {
      const chapterIndex = status === "outside-range" ? 11 : 5;
      const chapterStatus = status === "outside-range" ? "fresh" : status;
      const result = selectL2Scope({
        mode,
        force,
        startChapter: 1,
        endChapter: 10,
        chapters: [{ chapterId: "chapter-1", chapterIndex, status: chapterStatus }],
      });

      expect(result.execute).toEqual(expectedSelected(mode, status) ? [5] : []);
      expect(result.skip).toEqual(expectedSelected(mode, status) ? [] : [{ chapterIndex, reason: status }]);
    },
  );

  test("rejects invalid ranges and duplicate chapter indexes", () => {
    expect(() => selectL2Scope({ mode: "all", force: false, startChapter: 2, endChapter: 1, chapters: [] })).toThrow("Invalid L2 scope range");
    expect(() => selectL2Scope({
      mode: "all",
      force: false,
      startChapter: 1,
      endChapter: 2,
      chapters: [
        { chapterId: "chapter-1", chapterIndex: 1, status: "missing" },
        { chapterId: "chapter-2", chapterIndex: 1, status: "failed" },
      ],
    })).toThrow("Duplicate L2 chapter index");
  });

  test("returns chapters ordered by chapter index without mutating input", () => {
    const chapters: L2ChapterIndexState[] = [
      { chapterId: "chapter-2", chapterIndex: 2, status: "missing" },
      { chapterId: "chapter-1", chapterIndex: 1, status: "missing" },
    ];

    expect(selectL2Scope({ mode: "missing", force: false, startChapter: 1, endChapter: 2, chapters }).execute).toEqual([1, 2]);
    expect(chapters.map(({ chapterIndex }) => chapterIndex)).toEqual([2, 1]);
  });
});
