import type { AdvancedAnalysisExecutionSnapshot, AnalysisMode } from "@novel-analysis/contracts";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

const riskByPosition = new Map([
  [7, { importance: 1, confidence: 0 }],
  [19, { importance: 0.95, confidence: 0.1 }],
  [31, { importance: 0.9, confidence: 0.2 }],
  [43, { importance: 0.85, confidence: 0.3 }],
  [55, { importance: 0.8, confidence: 0.4 }],
  [67, { importance: 0.7, confidence: 0.5 }],
]);

export const ANALYSIS_MODE_GOLDEN = {
  chapterCount: 100,
  fast_index: { l1: 100, l2: 100, reviewedPositions: [] },
  balanced: { l1: 100, l2: 100, reviewedPositions: [7, 19, 31] },
  precision: { l1: 100, l2: 100, reviewedPositions: [7, 19, 31, 43, 55] },
  full_text: { l1: 0, l2: 0, reviewedPositions: Array.from({ length: 100 }, (_, index) => index + 1) },
} as const;

export function analysisModeSnapshot(mode: AnalysisMode): AdvancedAnalysisExecutionSnapshot {
  const expected = ANALYSIS_MODE_GOLDEN[mode];
  return {
    bookId: id(1),
    scopeHash: "a".repeat(64),
    template: { id: id(2), versionId: id(3), contentHash: "b".repeat(64) },
    mode,
    range: { startChapter: 1, endChapter: ANALYSIS_MODE_GOLDEN.chapterCount },
    indexGroup: mode === "full_text" ? null : { id: id(4), key: "general", name: "General", categoryScope: "general", configHash: "group-v1", promptVersionId: id(5) },
    executionVersions: {
      workflow: { target: "analysis-summary", id: id(6), contractVersion: "summary-v1", dslHash: "dsl-v1" },
      model: "model-v1",
      reasoningEffort: "medium",
      executorVersion: "executor-v1",
      l1SchemaVersion: "l1-route-v1",
      l2SchemaVersion: "l2-facts-v1",
      l2AdmissionVersion: "l2-admission-v1",
    },
    sourcePolicy: {
      indexGroupId: mode === "full_text" ? null : id(4),
      indexGroupConfigHash: mode === "full_text" ? null : "group-v1",
      chapterSourceVersions: ["source-v1"],
      l1: { selectedCount: expected.l1, freshCount: expected.l1 },
      l2: { selectedCount: expected.l2, freshCount: expected.l2 },
      readsL1: mode !== "full_text",
      readsL2: mode !== "full_text",
      readsOriginalChapters: mode !== "fast_index",
      reviewedChapterBoundary: expected.reviewedPositions.length === 0 ? null : { startChapter: 1, endChapter: 100, maximumChapterCount: expected.reviewedPositions.length },
    },
    chapters: Array.from({ length: ANALYSIS_MODE_GOLDEN.chapterCount }, (_, index) => {
      const position = index + 1;
      const risk = riskByPosition.get(position) ?? { importance: 0.1, confidence: 0.9 };
      return {
        id: id(100 + position),
        position,
        contentHmac: `hmac-${position}`,
        sourceVersion: "source-v1",
        l1: mode === "full_text" ? null : {
          id: id(300 + position), promptVersionId: id(5), workflowVersionId: id(7), inputSignature: `l1-${position}`, status: "fresh" as const,
          route: { route_schema_version: "l1-route-v1", route_entities: [], route_keywords: [`chapter-${position}`], signals: [], category_scores: {} },
        },
        l2: mode === "full_text" ? null : {
          inputSignature: `l2-${position}`, status: "fresh" as const,
          facts: [{ id: id(500 + position), subjectKey: `subject-${position}`, factType: "event", payload: `fact-${position}`, metadata: risk }],
        },
      };
    }),
  };
}
