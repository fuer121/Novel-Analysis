import { afterEach, describe, expect, it } from "vitest";

import { startPhase3Harness, type Phase3Harness } from "./helpers/phase3-harness.js";

describe("Phase 3 continuous query acceptance", () => {
  let harness: Phase3Harness | undefined;

  afterEach(async () => harness?.stop());

  it("resolves a referential follow-up through fresh turn-scoped recall", async () => {
    harness = await startPhase3Harness();
    const sessionId = await harness.createSession("陈平安研究");

    const first = await harness.ask(sessionId, "陈平安为何选择留下？");
    const second = await harness.ask(sessionId, "他后来承担了什么后果？");

    expect(first.intent.target).toBe("chen-ping-an");
    expect(second.intent.target).toBe("chen-ping-an");
    expect(second.evidenceVersion).not.toBe(first.evidenceVersion);
    expect(first.evidenceRecordIds).not.toEqual(second.evidenceRecordIds);
    expect(harness.summaryInputs[1]).not.toContain(first.answer);
    expect(first.evidence.every((item) => item.turnId === first.id)).toBe(true);
    expect(second.evidence.every((item) => item.turnId === second.id)).toBe(true);
    expect(second.evidence.some((item) => item.disposition === "excluded")).toBe(true);
    expect(second.sourceStats).toEqual({ candidates: 22, used: 20, excluded: 2, gaps: 1 });
    expect(second.trace).toEqual({
      kind: "single-target", target: "chen-ping-an", aliases: [], referents: ["他"], categories: [], keywords: ["后来"],
      sourceCounts: { candidates: 22, used: 20, excluded: 2 }, gapCount: 1, recallPolicyVersion: "query-recall-v1", summaryWorkflowVersion: "phase3-summary-v1",
    });
  });
});
