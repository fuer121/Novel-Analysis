import type { LegacyAnalysisDetail } from "@novel-analysis/contracts";

export const LEGACY_ANALYSIS_GOLDEN = [
  {
    id: "legacy-analysis-1",
    bookId: "00000000-0000-4000-8000-000000000001",
    name: "人物成长分析",
    startChapter: 1,
    endChapter: 120,
    status: "completed",
    result: { summary: "主角完成了第一阶段的成长" },
    diagnostics: [],
    readOnly: true,
    canResume: false,
    createdAt: "2026-01-10T08:00:00.000Z",
    updatedAt: "2026-01-10T08:30:00.000Z",
  },
] as const satisfies readonly LegacyAnalysisDetail[];
