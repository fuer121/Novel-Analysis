import { describe, expect, it, vi } from "vitest";

import { executeStage } from "../../scripts/phase5-rehearsal-stage/src/stage.js";

const requests = {
  initialize: { databaseUrlFile: "/input/database-url" },
  migrate: {
    sourceFile: "/input/source",
    databaseUrlFile: "/input/database-url",
    oldKeyFile: "/input/old-key",
    targetKeyFile: "/input/target-key",
    targetHmacKeyFile: "/input/target-hmac-key",
    manifestFile: "/output/manifest",
  },
  capacity: { databaseUrlFile: "/input/database-url" },
} as const;

describe("Phase 5 rehearsal stage source contract", () => {
  for (const mode of ["initialize", "migrate", "capacity"] as const) {
    it(`dispatches the fixed ${mode} mode and writes one machine result`, async () => {
      const operations = {
        initialize: vi.fn(async () => ({ initialized: true })),
        migrate: vi.fn(async () => ({ validations: 8 })),
        capacity: vi.fn(async () => ({ status: "PASS" })),
      };
      const writeResult = vi.fn(async () => undefined);

      await expect(executeStage([
        "--mode", mode,
        "--request-file", "/input/request",
        "--result-file", "/output/result",
      ], {
        ...operations,
        readRequest: vi.fn(async () => requests[mode]),
        writeResult,
      })).resolves.toBe(0);

      expect(operations[mode]).toHaveBeenCalledOnce();
      expect(operations[mode]).toHaveBeenCalledWith(requests[mode]);
      expect(writeResult).toHaveBeenCalledWith("/output/result", expect.objectContaining({
        schemaVersion: "phase5-rehearsal-stage-result-v1",
        mode,
        status: "passed",
      }));
    });
  }
});
