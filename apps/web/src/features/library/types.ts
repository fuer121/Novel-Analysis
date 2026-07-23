import type { BookAnalysisReadiness, BookSummary, FactReviewPage, IndexCoverage } from "@novel-analysis/contracts";

export type { BookAnalysisReadiness, BookSummary, FactReviewPage, IndexCoverage };

export interface IndexGroup {
  id: string;
  key: string;
  name: string;
  categoryScope: "general" | "magical_creature";
  status: "active" | "archived";
}

export interface ScopePreview extends IndexCoverage {
  executable: number;
  skipped: number;
  scopeHash: string;
}

export interface ImportScopePreview {
  requested: number;
  existingFresh: number;
  existingStale: number;
  executable: number;
  scopeHash: string;
}

export type ActionPreview = ScopePreview | ImportScopePreview;
