import { LegacyAnalysisDetailSchema, LegacyAnalysisSummarySchema, type LegacyAnalysisDetail, type LegacyAnalysisSummary } from "@novel-analysis/contracts";

export interface LegacyAnalysisReader {
  list(input: { bookId: string; actorId: string }): Promise<LegacyAnalysisSummary[]>;
  get(input: { bookId: string; analysisId: string; actorId: string }): Promise<LegacyAnalysisDetail | null>;
}

export const EMPTY_LEGACY_ANALYSIS_READER: Readonly<LegacyAnalysisReader> = Object.freeze({
  async list() { return []; },
  async get() { return null; },
} satisfies LegacyAnalysisReader);

export function createLegacyAnalysisFixtureReader(input: { ownerId: string; records: readonly LegacyAnalysisDetail[] }): LegacyAnalysisReader {
  const records = input.records.map((record) => structuredClone(LegacyAnalysisDetailSchema.parse({ ...record, readOnly: true, canResume: false })));
  return {
    async list({ bookId, actorId }) {
      if (actorId !== input.ownerId) return [];
      return records.filter((record) => record.bookId === bookId).map(({ result: _result, diagnostics: _diagnostics, ...summary }) => structuredClone(LegacyAnalysisSummarySchema.parse(summary)));
    },
    async get({ bookId, analysisId, actorId }) {
      if (actorId !== input.ownerId) return null;
      const record = records.find((candidate) => candidate.bookId === bookId && candidate.id === analysisId);
      return record ? structuredClone(record) : null;
    },
  };
}
