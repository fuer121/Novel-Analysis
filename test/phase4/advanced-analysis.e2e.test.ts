import { afterEach, describe, expect, it } from "vitest";
import type { AnalysisMode } from "@novel-analysis/contracts";

import { buildAnalysisExport } from "../../apps/web/src/features/analysis/analysis-export.js";

import {
  startPhase4ProcessHarness,
  type Phase4ProcessHarness,
} from "./helpers/phase4-harness.js";
import { ANALYSIS_MODE_GOLDEN } from "./fixtures/analysis-mode-golden.js";

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
    const templateResponse = await fixture.requestAs("owner", `/books/${fixture.bookId}/analysis-templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookId: fixture.bookId,
        name: "Phase 4 golden template",
        prompt: "PHASE4_PROMPT_PLAINTEXT",
        outputSchema: {
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
        },
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
      const preview = await previewResponse.json() as Record<string, any>;
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
        result: { items: [{ label: "accepted" }], summary: "phase4-result" },
      });

      const partContexts = fixture.difyCallsSince(callIndex).flatMap((call) => {
        const context = JSON.parse(String(call.inputs.context_json)) as { stage?: string; position?: number; chapter?: string | null };
        return context.stage === "part" ? [context] : [];
      });
      expect(partContexts).toHaveLength(100);
      expect(partContexts.filter((context) => context.chapter !== null).map((context) => context.position)).toEqual([...expected.reviewedPositions]);
      const snapshot = await fixture.executionSnapshot(created.run.id);
      expect(snapshot).toMatchObject({
        mode,
        range: { startChapter: 1, endChapter: 100 },
      });
      expect(snapshot.chapters).toHaveLength(100);
      const persisted = await harness.database.selectFrom("analysis_runs")
        .select(["execution_snapshot_ciphertext", "result_ciphertext"])
        .where("id", "=", created.run.id)
        .executeTakeFirstOrThrow();
      expect(persisted.execution_snapshot_ciphertext).toBeInstanceOf(Buffer);
      expect(persisted.result_ciphertext).toBeInstanceOf(Buffer);
      expect(persisted.execution_snapshot_ciphertext!.toString("utf8")).not.toContain("PHASE4_CHAPTER_PLAINTEXT");
      expect(persisted.result_ciphertext!.toString("utf8")).not.toContain("phase4-result");
      expect(buildAnalysisExport(`${mode}-result`, detail.result)).toMatchObject({
        filename: `${mode}-result.xls`,
        type: "application/vnd.ms-excel;charset=utf-8",
      });
    }
  });
});
