import { describe, expect, it } from "vitest";

import { ANALYSIS_MODE_GOLDEN, analysisModeSnapshot } from "../../../test/phase4/fixtures/analysis-mode-golden.js";
import { selectAnalysisSources } from "./analysis-source-selector.js";

describe("analysis source selector", () => {
  it.each(["fast_index", "balanced", "precision", "full_text"] as const)("keeps the frozen %s source boundary", async (mode) => {
    const snapshot = analysisModeSnapshot(mode);
    const decrypted: Array<{ id: string; position: number }> = [];

    const selected = await selectAnalysisSources(snapshot, async (chapter) => {
      decrypted.push({ id: chapter.id, position: chapter.position });
      return `chapter-${chapter.position}`;
    });

    const golden = ANALYSIS_MODE_GOLDEN[mode];
    expect(selected.l1).toHaveLength(golden.l1);
    expect(selected.l2).toHaveLength(golden.l2);
    expect(selected.chapters.map((chapter) => chapter.position)).toEqual(golden.reviewedPositions);
    expect(decrypted.map((chapter) => chapter.position)).toEqual(golden.reviewedPositions);
    expect(decrypted.map((chapter) => chapter.id)).toEqual(golden.reviewedPositions.map((position) => snapshot.chapters[position - 1]!.id));
  });

  it("rejects a snapshot source policy that disagrees with the accepted mode policy", async () => {
    const snapshot = analysisModeSnapshot("balanced");
    snapshot.sourcePolicy.reviewedChapterBoundary!.maximumChapterCount = 4;

    await expect(selectAnalysisSources(snapshot, async () => "content")).rejects.toThrow("snapshot source policy mismatch");
  });
});
