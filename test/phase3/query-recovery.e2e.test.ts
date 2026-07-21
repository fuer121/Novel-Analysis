import { afterEach, describe, expect, it } from "vitest";

import { startPhase3Harness, type Phase3Harness } from "./helpers/phase3-harness.js";

describe("Phase 3 query recovery acceptance", () => {
  let harness: Phase3Harness | undefined;

  afterEach(async () => harness?.stop());

  it.each(["retry-summary", "local-summary"] as const)("restores an awaiting turn and completes %s from the immutable evidence", async (kind) => {
    harness = await startPhase3Harness();
    const sessionId = await harness.createSession(`恢复-${kind}`);
    harness.failNextSummary();
    const awaiting = await harness.ask(sessionId, "陈平安为何选择留下？");

    expect(awaiting.status).toBe("awaiting_fallback");
    const evidenceVersion = awaiting.evidenceVersion;
    await harness.restartRuntime();

    const completed = await harness.fallback(sessionId, awaiting.id, kind);

    expect(completed.status).toBe(kind === "retry-summary" ? "completed" : "degraded");
    expect(completed.evidenceVersion).toBe(evidenceVersion);
    expect(completed.evidence).toEqual(awaiting.evidence);
    expect(await harness.evidenceRowCount(awaiting.id)).toBe(22);
    expect(await harness.authoritativeResultCounts(awaiting.id)).toEqual({ attempts: 2, evidence: 22, answers: 1 });
  });

  it("discards a late first attempt after lease recovery", async () => {
    harness = await startPhase3Harness();
    const sessionId = await harness.createSession("租约恢复");

    const completed = await harness.askWithLateResult(sessionId, "陈平安如何应对？");

    expect(completed.status).toBe("completed");
    expect(completed.answer).not.toContain("PHASE3_LATE_PROVIDER_ANSWER");
    expect(await harness.attemptStatuses(completed.id)).toEqual(["abandoned", "completed"]);
    expect(await harness.authoritativeResultCounts(completed.id)).toEqual({ attempts: 2, evidence: 22, answers: 1 });
  });
});
