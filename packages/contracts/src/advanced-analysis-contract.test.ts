import { describe, expect, it } from "vitest";

import {
  AdminAnalysisRunMetadataSchema,
  AnalysisModeSchema,
  AnalysisPartSummarySchema,
  AnalysisRunCreateInputSchema,
  AnalysisRunDetailSchema,
  AnalysisRunSummarySchema,
  AnalysisScopePreviewInputSchema,
  AnalysisScopePreviewSchema,
  AnalysisTemplateCreateInputSchema,
  AnalysisTemplateDetailSchema,
  AnalysisTemplateSummarySchema,
  AnalysisTemplateUpdateInputSchema,
  LegacyAnalysisDetailSchema,
  LegacyAnalysisSummarySchema,
} from "./advanced-analysis-contract.js";

const ids = {
  analysis: "00000000-0000-4000-8000-000000000001",
  book: "00000000-0000-4000-8000-000000000002",
  owner: "00000000-0000-4000-8000-000000000003",
  template: "00000000-0000-4000-8000-000000000004",
  version: "00000000-0000-4000-8000-000000000005",
  group: "00000000-0000-4000-8000-000000000006",
  job: "00000000-0000-4000-8000-000000000007",
  part: "00000000-0000-4000-8000-000000000008",
};
const now = "2026-07-21T12:00:00.000Z";

describe("advanced analysis contracts", () => {
  it("accepts exactly the four compatible modes", () => {
    expect(AnalysisModeSchema.options).toEqual([
      "fast_index", "balanced", "precision", "full_text",
    ]);
    expect(AnalysisModeSchema.safeParse("fast").success).toBe(false);
  });

  it("strictly validates private template create and update inputs", () => {
    const create = {
      bookId: ids.book, name: "人物分析", prompt: "分析人物弧光",
      outputSchema: { type: "object" }, indexGroupId: ids.group,
    };
    const update = {
      name: "人物分析 v2", prompt: "分析人物关系与弧光",
      outputSchema: { type: "object", required: ["summary"] }, indexGroupId: null,
    };

    expect(AnalysisTemplateCreateInputSchema.parse(create)).toEqual(create);
    expect(AnalysisTemplateUpdateInputSchema.parse(update)).toEqual(update);
    expect(AnalysisTemplateCreateInputSchema.safeParse({ ...create, createdBy: ids.owner }).success).toBe(false);
    expect(AnalysisTemplateUpdateInputSchema.safeParse({ ...update, bookId: ids.book }).success).toBe(false);
    expect(AnalysisTemplateCreateInputSchema.safeParse({ ...create, prompt: " " }).success).toBe(false);
  });

  it("exposes private template summaries and content only in owner details", () => {
    const summary = {
      id: ids.template, bookId: ids.book, name: "人物分析",
      currentVersionId: ids.version, indexGroupId: ids.group,
      createdAt: now, updatedAt: now,
    };
    expect(AnalysisTemplateSummarySchema.parse(summary)).toEqual(summary);
    expect(AnalysisTemplateDetailSchema.parse({
      ...summary, prompt: "分析人物", outputSchema: { type: "object" },
    })).toHaveProperty("prompt", "分析人物");
  });

  it("requires a valid inclusive chapter range and preview hash", () => {
    const preview = {
      bookId: ids.book, templateVersionId: ids.version, mode: "balanced",
      startChapter: 3, endChapter: 12, chapterCount: 10,
      reviewChapterCount: 3, readsL1: true, readsL2: true,
      readsOriginalChapters: true, scopeHash: "a".repeat(64),
    };

    expect(AnalysisScopePreviewSchema.parse(preview)).toEqual(preview);
    expect(AnalysisScopePreviewSchema.safeParse({ ...preview, endChapter: 2 }).success).toBe(false);
    for (const scopeHash of ["sha256:scope-v1", "a".repeat(63), "A".repeat(64), "g".repeat(64)]) {
      expect(AnalysisScopePreviewSchema.safeParse({ ...preview, scopeHash }).success).toBe(false);
    }

    const previewInput = {
      bookId: ids.book, templateId: ids.template, mode: "balanced",
      startChapter: 3, endChapter: 12,
    };
    expect(AnalysisScopePreviewInputSchema.parse(previewInput)).toEqual(previewInput);
    expect(AnalysisScopePreviewInputSchema.safeParse({ ...previewInput, startChapter: 13 }).success).toBe(false);

    const createInput = {
      ...previewInput, templateVersionId: ids.version,
      scopeHash: preview.scopeHash, idempotencyKey: "analysis-request-1",
    };
    expect(AnalysisRunCreateInputSchema.parse(createInput)).toEqual(createInput);
    expect(AnalysisRunCreateInputSchema.safeParse({ ...createInput, scopeHash: "a".repeat(65) }).success).toBe(false);
  });

  it("exposes owner run summaries, details, results and part progress", () => {
    const summary = {
      id: ids.analysis, bookId: ids.book, templateVersionId: ids.version,
      jobId: ids.job, mode: "precision", startChapter: 1, endChapter: 100,
      status: "running", completedParts: 2, totalParts: 5,
      createdAt: now, updatedAt: now,
    };
    const part = {
      id: ids.part, position: 2, kind: "chapter_review", status: "completed",
      errorCode: null, createdAt: now, updatedAt: now,
    };

    expect(AnalysisRunSummarySchema.parse(summary)).toEqual(summary);
    expect(AnalysisPartSummarySchema.parse(part)).toEqual(part);
    expect(AnalysisRunDetailSchema.parse({
      ...summary, parts: [part], result: { summary: "完成" }, diagnostics: ["partial-source"],
    })).toMatchObject({ result: { summary: "完成" }, parts: [part] });
    expect(AnalysisRunSummarySchema.safeParse({ ...summary, result: "private" }).success).toBe(false);
  });

  it.each(["prompt", "outputSchema", "result", "partContent", "contentHash", "resultHmac", "partInputSignature"])(
    "rejects administrator metadata content or fingerprint key %s",
    (key) => {
      const metadata = {
        id: ids.analysis, jobId: ids.job, bookId: ids.book, createdBy: ids.owner,
        mode: "balanced", status: "running", completedParts: 2, totalParts: 5,
        errorCode: null, createdAt: now, updatedAt: now,
      };
      expect(AdminAnalysisRunMetadataSchema.parse(metadata)).toEqual(metadata);
      expect(AdminAnalysisRunMetadataSchema.safeParse({ ...metadata, [key]: "SENTINEL" }).success).toBe(false);
    },
  );

  it("fixes legacy projections to read-only and non-resumable", () => {
    const summary = {
      id: "legacy-1", bookId: ids.book, name: "人物分析",
      startChapter: 1, endChapter: 10, status: "completed",
      readOnly: true, canResume: false, createdAt: now, updatedAt: now,
    };
    expect(LegacyAnalysisSummarySchema.parse(summary)).toEqual(summary);
    expect(LegacyAnalysisDetailSchema.parse({
      ...summary, result: { summary: "旧结果" }, diagnostics: [],
    })).toHaveProperty("canResume", false);
    expect(LegacyAnalysisDetailSchema.safeParse({
      ...summary, canResume: true, result: {}, diagnostics: [],
    }).success).toBe(false);
    expect(LegacyAnalysisDetailSchema.safeParse({
      ...summary, result: {}, diagnostics: [], delete: true,
    }).success).toBe(false);
  });
});
