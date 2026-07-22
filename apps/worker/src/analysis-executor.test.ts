import { describe, expect, it } from "vitest";

import { analysisModeSnapshot } from "../../../test/phase4/fixtures/analysis-mode-golden.js";
import { buildFinalCheckpointInput, buildHierarchicalSummaryInput, checkpointPositions, validateFinalAnalysisResult } from "./analysis-executor.js";

describe("analysis execution units", () => {
  it("builds deterministic hierarchical input from ordered child checkpoints", () => {
    const snapshot = analysisModeSnapshot("full_text");
    const right = buildHierarchicalSummaryInput(snapshot, [
      { position: 2, inputSignature: "signature-2", result: "result-2" },
      { position: 1, inputSignature: "signature-1", result: "result-1" },
    ]);
    const left = buildHierarchicalSummaryInput(snapshot, [
      { position: 1, inputSignature: "signature-1", result: "result-1" },
      { position: 2, inputSignature: "signature-2", result: "result-2" },
    ]);

    expect(right).toEqual(left);
    expect(right.input.children.map((child) => child.position)).toEqual([1, 2]);
    expect(buildHierarchicalSummaryInput(snapshot, [{ position: 1, inputSignature: "signature-1", result: "changed" }]).inputSignature).not.toBe(left.inputSignature);
  });

  it("derives non-conflicting summary and final positions and signatures", () => {
    const snapshot = analysisModeSnapshot("full_text");
    expect(checkpointPositions(snapshot)).toEqual({ hierarchical: [101, 102, 103, 104, 105], final: 106 });
    const hierarchical = buildHierarchicalSummaryInput(snapshot, [{ position: 1, inputSignature: "child", result: "result" }]);
    const final = buildFinalCheckpointInput(snapshot, [{ position: 101, inputSignature: hierarchical.inputSignature, result: "summary" }]);
    expect(final.input.hierarchical.map((checkpoint) => checkpoint.position)).toEqual([101]);
    expect(final.inputSignature).not.toBe(hierarchical.inputSignature);
  });

  it.each(["", " ", "{}", "[]", "null"])("rejects empty final output %j", (text) => {
    expect(() => validateFinalAnalysisResult(text, {})).toThrow("invalid_output_schema");
  });
});
