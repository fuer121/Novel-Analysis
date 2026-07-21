import { afterEach, describe, expect, it } from "vitest";

import { startPhase3Harness, type Phase3Harness } from "./helpers/phase3-harness.js";

describe("Phase 3 query scale and isolation acceptance", () => {
  let harness: Phase3Harness | undefined;

  afterEach(async () => harness?.stop());

  it("completes 10 authenticated queries within local thresholds without duplicate authority", async () => {
    harness = await startPhase3Harness();

    const result = await harness.runConcurrentAcceptance(10);

    expect(result.completionP95Ms).toBeLessThan(2_000);
    expect(result.readP95Ms).toBeLessThan(500);
    expect(result.principalCount).toBe(10);
    expect(result.authorityMatches).toBe(true);
    expect(result.turns).toHaveLength(10);
    expect(new Set(result.turns.map((turn) => turn.id))).toHaveLength(10);
    expect(result.turns.every((turn) => turn.answerCount === 1 && turn.evidenceSnapshotCount === 1)).toBe(true);
  });

  it("keeps plaintext and credential sentinels inside encrypted or controlled fake boundaries", async () => {
    harness = await startPhase3Harness();

    const audit = await harness.runSentinelAudit();

    expect(audit.rawProviderErrorContainsEverySentinel).toBe(true);
    expect(audit.persistedLeaks).toEqual([]);
    expect(audit.publicLeaks).toEqual([]);
    expect(audit.applicationLogLeaks).toEqual([]);
    expect(audit.stableErrorCode).toBe("provider_unavailable");
  });
});
