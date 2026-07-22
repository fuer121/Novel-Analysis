import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";
import type {
  AnalysisMode,
  AnalysisScopePreview,
} from "@novel-analysis/contracts";

import {
  buildAnalysisExport,
  tableViewsFromJson,
} from "../../apps/web/src/features/analysis/analysis-export.js";

import {
  startPhase4ProcessHarness,
  type Phase4ProcessHarness,
} from "./helpers/phase4-harness.js";
import { ANALYSIS_MODE_GOLDEN } from "./fixtures/analysis-mode-golden.js";

const finalResult = {
  items: [{ label: "accepted & <verified> \"quoted\"" }],
  summary: "phase4-result",
};

describe("Phase 4 independent process harness", () => {
  let harness: Phase4ProcessHarness | undefined;

  afterEach(async () => {
    await harness?.stop();
  });

  it("starts real API and Worker processes against disposable PostgreSQL and captures logs", async () => {
    harness = await startPhase4ProcessHarness();

    expect(harness.api.child.pid).toEqual(expect.any(Number));
    expect(harness.worker.child.pid).toEqual(expect.any(Number));
    expect(harness.api.child.pid).not.toBe(process.pid);
    expect(harness.worker.child.pid).not.toBe(process.pid);
    expect(harness.worker.child.pid).not.toBe(harness.api.child.pid);
    expect(harness.databaseUrl).toMatch(/^postgres:/);
    expect(await harness.database.selectFrom("users").select("id").execute()).toEqual([]);
    expect(harness.api.logs).toEqual(expect.any(Array));
    expect(harness.worker.logs).toEqual(expect.any(Array));
  });

  it("executes the four-mode golden matrix through real API and Worker processes", async () => {
    harness = await startPhase4ProcessHarness();
    const fixture = await harness.prepareGoldenFixtures();
    const prompt = "PHASE4_PROMPT_PLAINTEXT";
    const outputSchema = {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { label: { type: "string" } },
            required: ["label"],
            additionalProperties: false,
          },
        },
        summary: { type: "string" },
      },
      required: ["items", "summary"],
      additionalProperties: false,
    };
    const templateContentHash = createHash("sha256")
      .update(JSON.stringify({ prompt, outputSchema }))
      .digest("hex");
    const templateResponse = await fixture.requestAs("owner", `/books/${fixture.bookId}/analysis-templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookId: fixture.bookId,
        name: "Phase 4 golden template",
        prompt,
        outputSchema,
        indexGroupId: fixture.groupId,
      }),
    });
    expect(templateResponse.status).toBe(201);
    const template = (await templateResponse.json() as { template: { id: string; currentVersionId: string } }).template;

    const modes: AnalysisMode[] = ["fast_index", "balanced", "precision", "full_text"];
    for (const mode of modes) {
      const previewResponse = await fixture.requestAs("owner", `/books/${fixture.bookId}/advanced-analysis/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId: fixture.bookId, templateId: template.id, mode, startChapter: 1, endChapter: 100 }),
      });
      expect(previewResponse.status).toBe(200);
      const preview = await previewResponse.json() as AnalysisScopePreview;
      const expected = ANALYSIS_MODE_GOLDEN[mode];
      expect(preview).toMatchObject({
        mode,
        chapterCount: 100,
        reviewChapterCount: expected.reviewedPositions.length,
        sourceSummary: {
          l1: { selectedCount: expected.l1, freshCount: expected.l1 },
          l2: { selectedCount: expected.l2, freshCount: expected.l2 },
        },
      });

      const callIndex = fixture.difyCallCount();
      const createdResponse = await fixture.requestAs("owner", `/books/${fixture.bookId}/advanced-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId: fixture.bookId,
          templateId: template.id,
          templateVersionId: preview.templateVersionId,
          mode,
          startChapter: 1,
          endChapter: 100,
          scopeHash: preview.scopeHash,
          idempotencyKey: `phase4-golden-${mode}`,
        }),
      });
      expect(createdResponse.status).toBe(201);
      const created = await createdResponse.json() as { run: { id: string } };
      const detail = await fixture.waitForRun(created.run.id);
      expect(detail).toMatchObject({
        id: created.run.id,
        mode,
        status: "completed",
        completedParts: 100,
        totalParts: 100,
        result: finalResult,
      });

      const partContexts = fixture.difyCallsSince(callIndex).flatMap((call) => {
        const context = JSON.parse(String(call.inputs.context_json)) as {
          stage?: string;
          mode?: AnalysisMode;
          position?: number;
          l1?: unknown;
          l2?: unknown;
          chapter?: string | null;
        };
        return context.stage === "part" ? [context] : [];
      });
      expect(partContexts).toHaveLength(100);
      const snapshot = await fixture.executionSnapshot(created.run.id);
      const expectedSnapshot = fixture.expectedExecutionSnapshot({
        mode,
        scopeHash: preview.scopeHash,
        template: {
          id: template.id,
          versionId: template.currentVersionId,
          contentHash: templateContentHash,
        },
      });
      expect(snapshot).toEqual(expectedSnapshot);
      const reviewedPositions: readonly number[] = expected.reviewedPositions;
      expect(partContexts).toEqual(snapshot.chapters.map((chapter) => ({
        stage: "part",
        mode,
        position: chapter.position,
        l1: snapshot.sourcePolicy.readsL1 ? chapter.l1 : null,
        l2: snapshot.sourcePolicy.readsL2 ? chapter.l2 : null,
        chapter: reviewedPositions.includes(chapter.position)
          ? `PHASE4_CHAPTER_PLAINTEXT_${chapter.position}`
          : null,
      })));
      expect(partContexts.filter((context) => context.l1 !== null)).toHaveLength(preview.sourceSummary.l1.selectedCount);
      expect(partContexts.filter((context) => context.l2 !== null)).toHaveLength(preview.sourceSummary.l2.selectedCount);
      expect(partContexts.filter((context) => context.chapter !== null)).toHaveLength(preview.reviewChapterCount);
      const persisted = await harness.database.selectFrom("analysis_runs")
        .select(["execution_snapshot_ciphertext", "result_ciphertext"])
        .where("id", "=", created.run.id)
        .executeTakeFirstOrThrow();
      expect(persisted.execution_snapshot_ciphertext).toBeInstanceOf(Buffer);
      expect(persisted.result_ciphertext).toBeInstanceOf(Buffer);
      expect(persisted.execution_snapshot_ciphertext!.toString("utf8")).not.toContain("PHASE4_CHAPTER_PLAINTEXT");
      expect(persisted.result_ciphertext!.toString("utf8")).not.toContain("phase4-result");
      const exported = buildAnalysisExport(`${mode}-result`, detail.result);
      expect(tableViewsFromJson(detail.result)).toEqual([
        {
          key: "items",
          title: "分析条目",
          rows: finalResult.items,
          columns: [{ key: "label", label: "label" }],
        },
        {
          key: "summary_fields",
          title: "结果字段",
          rows: [{ field: "summary", value: "phase4-result" }],
          columns: [{ key: "field", label: "字段" }, { key: "value", label: "值" }],
        },
      ]);
      expect(exported).toMatchObject({
        filename: `${mode}-result.xls`,
        type: "application/vnd.ms-excel;charset=utf-8",
      });
      expect(exported.content).toContain(`<DocumentProperties xmlns="urn:schemas-microsoft-com:office:office"><Title>${mode}-result</Title></DocumentProperties>`);
      expect(exported.content).toContain("<Worksheet ss:Name=\"分析条目\"><Table><Row><Cell><Data ss:Type=\"String\">label</Data></Cell></Row>");
      expect(exported.content).toContain("accepted &amp; &lt;verified&gt; &quot;quoted&quot;");
      expect(exported.content).toContain("<Worksheet ss:Name=\"结果字段\"><Table><Row><Cell><Data ss:Type=\"String\">字段</Data></Cell><Cell><Data ss:Type=\"String\">值</Data></Cell></Row>");
      expect(exported.content).toContain("<Cell><Data ss:Type=\"String\">summary</Data></Cell><Cell><Data ss:Type=\"String\">phase4-result</Data></Cell>");
      expect(exported.content).not.toContain(finalResult.items[0].label);
    }

    const coverage = await harness.captureWorkerCoverage();
    expect(coverage).toEqual({ decryptFrozenChapter: 108 });
  });
});
