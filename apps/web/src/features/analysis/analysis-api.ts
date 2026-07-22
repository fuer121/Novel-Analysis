import type {
  AnalysisMode,
  AnalysisRunCreateInput,
  AnalysisRunDetail,
  AnalysisRunSummary,
  AnalysisScopePreview,
  AnalysisScopePreviewInput,
  AnalysisTemplateCreateInput,
  AnalysisTemplateDetail,
  AnalysisTemplateSummary,
  AnalysisTemplateUpdateInput,
  JobResponse,
  LegacyAnalysisDetail,
  LegacyAnalysisSummary,
} from "@novel-analysis/contracts";

import { apiRead, apiWrite } from "../../shared/api.js";

export const analysisKeys = {
  templates: (bookId: string) => ["analysis", bookId, "templates"] as const,
  template: (bookId: string, templateId: string) => ["analysis", bookId, "template", templateId] as const,
  runs: (bookId: string) => ["analysis", bookId, "runs"] as const,
  run: (bookId: string, runId: string) => ["analysis", bookId, "run", runId] as const,
  legacy: (bookId: string) => ["analysis", bookId, "legacy"] as const,
  legacyDetail: (bookId: string, analysisId: string) => ["analysis", bookId, "legacy", analysisId] as const,
};

export const modeLabels: Record<AnalysisMode, string> = {
  fast_index: "快速索引",
  balanced: "均衡分析",
  precision: "精确分析",
  full_text: "全文分析",
};

export const modeDescriptions: Record<AnalysisMode, string> = {
  fast_index: "仅读取 L1、L2 索引，不读取原文",
  balanced: "读取 L1、L2，并复核少量原文章节",
  precision: "读取 L1、L2，并复核更多原文章节",
  full_text: "读取所选章节全文",
};

export function listAnalysisTemplates(bookId: string) {
  return apiRead<{ templates: AnalysisTemplateSummary[] }>(`/books/${bookId}/analysis-templates`);
}
export function readAnalysisTemplate(bookId: string, templateId: string) {
  return apiRead<{ template: AnalysisTemplateDetail }>(`/books/${bookId}/analysis-templates/${templateId}`);
}
export function createAnalysisTemplate(bookId: string, input: AnalysisTemplateCreateInput) {
  return apiWrite<{ template: AnalysisTemplateSummary }>(`/books/${bookId}/analysis-templates`, { method: "POST", body: JSON.stringify(input) });
}
export function updateAnalysisTemplate(bookId: string, templateId: string, input: AnalysisTemplateUpdateInput) {
  return apiWrite<{ template: AnalysisTemplateDetail }>(`/books/${bookId}/analysis-templates/${templateId}`, { method: "PATCH", body: JSON.stringify(input) });
}
export function previewAnalysis(bookId: string, input: AnalysisScopePreviewInput) {
  return apiWrite<AnalysisScopePreview>(`/books/${bookId}/advanced-analysis/preview`, { method: "POST", body: JSON.stringify(input) });
}
export function createAnalysisRun(bookId: string, input: AnalysisRunCreateInput) {
  return apiWrite<{ run: AnalysisRunSummary }>(`/books/${bookId}/advanced-analysis`, { method: "POST", body: JSON.stringify(input) }, input.idempotencyKey);
}
export function listAnalysisRuns(bookId: string) {
  return apiRead<{ runs: AnalysisRunSummary[] }>(`/books/${bookId}/advanced-analysis`);
}
export function readAnalysisRun(bookId: string, runId: string) {
  return apiRead<{ run: AnalysisRunDetail }>(`/books/${bookId}/advanced-analysis/${runId}`);
}
export function controlAnalysisRun(jobId: string, action: "pause" | "resume" | "cancel") {
  return apiWrite<JobResponse>(`/jobs/${jobId}/${action}`, { method: "POST" });
}
export function deleteAnalysisRun(bookId: string, runId: string) {
  return apiWrite<void>(`/books/${bookId}/advanced-analysis/${runId}`, { method: "DELETE" });
}
export function listLegacyAnalyses(bookId: string) {
  return apiRead<{ analyses: LegacyAnalysisSummary[] }>(`/books/${bookId}/legacy-analysis`);
}
export function readLegacyAnalysis(bookId: string, analysisId: string) {
  return apiRead<{ analysis: LegacyAnalysisDetail }>(`/books/${bookId}/legacy-analysis/${analysisId}`);
}
