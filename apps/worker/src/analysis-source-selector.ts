import type { AdvancedAnalysisExecutionSnapshot } from "@novel-analysis/contracts";
import { modeSourcePolicy } from "@novel-analysis/domain";

type FrozenChapter = AdvancedAnalysisExecutionSnapshot["chapters"][number];

export type SelectedAnalysisSources = {
  l1: Array<{ position: number; value: FrozenChapter["l1"] }>;
  l2: Array<{ position: number; value: FrozenChapter["l2"] }>;
  chapters: Array<{ id: string; position: number; content: string }>;
};

function reviewCandidates(snapshot: AdvancedAnalysisExecutionSnapshot, budget: number): FrozenChapter[] {
  const scored = snapshot.chapters.flatMap((chapter) => {
    const scores = (chapter.l2?.facts ?? []).flatMap((fact) => {
      const importance = fact.metadata.importance ?? 0;
      const confidence = fact.metadata.confidence ?? 0;
      return importance < 0.65 && confidence >= 0.55 ? [] : [(importance * 2) + (1 - confidence)];
    });
    return scores.length === 0 ? [] : [{ chapter, score: Math.max(...scores) }];
  });
  return scored
    .sort((left, right) => (right.score - left.score) || (left.chapter.position - right.chapter.position))
    .slice(0, budget)
    .map(({ chapter }) => chapter);
}

function assertFrozenPolicy(snapshot: AdvancedAnalysisExecutionSnapshot): ReturnType<typeof modeSourcePolicy> {
  const expected = modeSourcePolicy(snapshot.mode, snapshot.chapters.length);
  const boundaryCount = snapshot.sourcePolicy.reviewedChapterBoundary?.maximumChapterCount ?? 0;
  if (snapshot.sourcePolicy.readsL1 !== expected.readsL1
    || snapshot.sourcePolicy.readsL2 !== expected.readsL2
    || snapshot.sourcePolicy.readsOriginalChapters !== expected.readsOriginalChapters
    || boundaryCount !== expected.reviewChapterCount) {
    throw new Error("snapshot source policy mismatch");
  }
  return expected;
}

export async function selectAnalysisSources(
  snapshot: AdvancedAnalysisExecutionSnapshot,
  decryptChapter: (chapter: FrozenChapter) => Promise<string>,
): Promise<SelectedAnalysisSources> {
  const policy = assertFrozenPolicy(snapshot);
  const selectedChapters = snapshot.mode === "full_text"
    ? snapshot.chapters
    : reviewCandidates(snapshot, policy.reviewChapterCount);
  const chapters = [];
  for (const chapter of selectedChapters) {
    chapters.push({ id: chapter.id, position: chapter.position, content: await decryptChapter(chapter) });
  }
  return {
    l1: policy.readsL1 ? snapshot.chapters.map((chapter) => ({ position: chapter.position, value: chapter.l1 })) : [],
    l2: policy.readsL2 ? snapshot.chapters.map((chapter) => ({ position: chapter.position, value: chapter.l2 })) : [],
    chapters,
  };
}
