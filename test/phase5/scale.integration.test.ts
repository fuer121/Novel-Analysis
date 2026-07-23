import { afterEach, describe, expect, it } from "vitest";

import { PHASE5_SCALE_PROFILE } from "./fixtures/scale-profile.js";
import {
  nearestRankP95,
  runPhase5Load,
  writePhase5LoadReport,
} from "./helpers/load-runner.js";
import {
  createPhase5ScaleHarness,
  type Phase5ScaleHarness,
} from "./helpers/phase5-harness.js";

describe("Phase 5 load report contracts", () => {
  it("calculates p95 with the nearest-rank definition", () => {
    expect(nearestRankP95([
      20, 1, 19, 2, 18, 3, 17, 4, 16, 5,
      15, 6, 14, 7, 13, 8, 12, 9, 11, 10,
    ])).toBe(19);
    expect(nearestRankP95([7])).toBe(7);
    expect(() => nearestRankP95([])).toThrow("p95 requires at least one sample");
  });
});

describe("Phase 5 production-scale capacity evidence", () => {
  let harness: Phase5ScaleHarness | undefined;

  afterEach(async () => harness?.stop());

  it("meets the accepted thresholds through real API, PostgreSQL, and a controlled provider", async () => {
    harness = await createPhase5ScaleHarness(PHASE5_SCALE_PROFILE);

    const report = await runPhase5Load(harness, PHASE5_SCALE_PROFILE);
    await writePhase5LoadReport(report, process.env.PHASE5_LOAD_REPORT_PATH);
    console.info("PHASE5_LOAD_REPORT", JSON.stringify(report));

    expect(report.dataset).toEqual(PHASE5_SCALE_PROFILE.dataset);
    expect(report.browse.users).toBe(20);
    expect(report.submit.users).toBe(10);
    expect(report.rawSamplesMs.browse).toHaveLength(20);
    expect(report.rawSamplesMs.submit).toHaveLength(10);
    expect(report.rawSamplesMs.statusPropagation).toHaveLength(10);
    expect(report.browse.p95Ms).toBeLessThan(PHASE5_SCALE_PROFILE.thresholds.browseP95Ms);
    expect(report.submit.p95Ms).toBeLessThan(PHASE5_SCALE_PROFILE.thresholds.submitP95Ms);
    expect(report.statusPropagationP95Ms).toBeLessThan(
      PHASE5_SCALE_PROFILE.thresholds.statusPropagationP95Ms,
    );
    expect(report.priority).toEqual({
      interactiveAheadOfQueuedBackground: true,
      runningStepUninterrupted: true,
    });
    expect(report.checks).toEqual({
      browse: "PASS",
      submit: "PASS",
      statusPropagation: "PASS",
      interactivePriority: "PASS",
    });
    expect(report.status).toBe("PASS");
  }, 180_000);
});
