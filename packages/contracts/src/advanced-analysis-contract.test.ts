import { describe, expect, it } from "vitest";

import {
  AdminAnalysisRunMetadataSchema,
  AdvancedAnalysisExecutionConfigSchema,
  AdvancedAnalysisExecutionSnapshotSchema,
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
  it("strictly validates explicit execution config and encrypted snapshot payload", () => {
    const config = { model: "deepseek-chat", reasoningEffort: "high", executorVersion: "analysis-v1" };
    expect(AdvancedAnalysisExecutionConfigSchema.parse(config)).toEqual(config);
    expect(AdvancedAnalysisExecutionConfigSchema.safeParse({ ...config, extra: true }).success).toBe(false);
    const snapshot = {
      bookId: ids.book, scopeHash: "a".repeat(64), template: { id: ids.template, versionId: ids.version, contentHash: "b".repeat(64) }, mode: "balanced",
      range: { startChapter: 1, endChapter: 1 }, indexGroup: { id: ids.group, key: "people", name: "People", categoryScope: "general", configHash: "group-v1", promptVersionId: ids.version },
      executionVersions: { workflow: { target: "analysis-summary", id: ids.job, contractVersion: "v1", dslHash: "dsl" }, ...config, l1SchemaVersion: "l1-v1", l2SchemaVersion: "l2-v1", l2AdmissionVersion: "admission-v1" },
      sourcePolicy: { indexGroupId: ids.group, indexGroupConfigHash: "group-v1", chapterSourceVersions: ["source-v1"], l1: { selectedCount: 1, freshCount: 1 }, l2: { selectedCount: 1, freshCount: 1 }, readsL1: true, readsL2: true, readsOriginalChapters: true, reviewedChapterBoundary: { startChapter: 1, endChapter: 1, maximumChapterCount: 1 } },
      chapters: [{ id: ids.part, position: 1, contentHmac: "chapter-hmac", sourceVersion: "source-v1", l1: { id: ids.analysis, promptVersionId: ids.version, workflowVersionId: ids.job, inputSignature: "l1-signature", status: "fresh" }, l2: { inputSignature: "l2-signature", status: "fresh", facts: [{ id: ids.analysis, subjectKey: "hero", factType: "event", payload: "FACT_PAYLOAD_SENTINEL", metadata: { category: "event" } }] } }],
    };
    expect(AdvancedAnalysisExecutionSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(AdvancedAnalysisExecutionSnapshotSchema.safeParse({ ...snapshot, plaintextChapter: "forbidden" }).success).toBe(false);
  });
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
      executionVersions: {
        workflow: { target: "analysis-summary", id: ids.job, contractVersion: "summary-v1", dslHash: "dsl-v1" },
        model: "deepseek-chat", reasoningEffort: "workflow-default", executorVersion: "advanced-analysis-v1",
        l1SchemaVersion: "l1-route-v1", l2SchemaVersion: "l2-facts-v1", l2AdmissionVersion: "l2-admission-v1",
      },
      sourceSummary: {
        indexGroupId: ids.group, indexGroupConfigHash: "group-v1", chapterSourceVersions: ["source-v1"],
        l1: { selectedCount: 10, freshCount: 8 }, l2: { selectedCount: 10, freshCount: 7 },
        readsL1: true, readsL2: true, readsOriginalChapters: true,
        reviewedChapterBoundary: { startChapter: 3, endChapter: 12, maximumChapterCount: 3 },
      },
    };

    expect(AnalysisScopePreviewSchema.parse(preview)).toEqual(preview);
    expect(AnalysisScopePreviewSchema.safeParse({ ...preview, endChapter: 2 }).success).toBe(false);
    expect(AnalysisScopePreviewSchema.safeParse({ ...preview, executionVersions: { ...preview.executionVersions, unknown: true } }).success).toBe(false);
    expect(AnalysisScopePreviewSchema.safeParse({ ...preview, sourceSummary: { ...preview.sourceSummary, prompt: "private" } }).success).toBe(false);
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

  it("rejects impossible owner and administrator progress", () => {
    const summary = {
      id: ids.analysis, bookId: ids.book, templateVersionId: ids.version,
      jobId: ids.job, mode: "precision", startChapter: 1, endChapter: 100,
      status: "running", completedParts: 2, totalParts: 1,
      createdAt: now, updatedAt: now,
    };
    const part = {
      id: ids.part, position: 0, kind: "chapter_review", status: "completed",
      errorCode: null, createdAt: now, updatedAt: now,
    };
    const adminMetadata = {
      id: ids.analysis, jobId: ids.job, bookId: ids.book, createdBy: ids.owner,
      mode: "precision", status: "running", completedParts: 2, totalParts: 1,
      errorCode: null, createdAt: now, updatedAt: now,
    };

    expect(AnalysisRunSummarySchema.safeParse(summary).success).toBe(false);
    expect(AnalysisRunDetailSchema.safeParse({
      ...summary, parts: [part], result: null, diagnostics: [],
    }).success).toBe(false);
    expect(AdminAnalysisRunMetadataSchema.safeParse(adminMetadata).success).toBe(false);
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
