import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { verifyPhase4Viewports } from "./helpers/phase4-viewport.js";

describe("Phase 4 viewport acceptance", () => {
  it("replays the Task 6 verifier at every accepted viewport with accessible controls and screenshots", async () => {
    const evidence = await verifyPhase4Viewports();

    expect(evidence.map((item) => item.viewport)).toEqual([
      [1440, 900],
      [1280, 800],
      [768, 800],
      [390, 760],
    ]);
    for (const item of evidence) {
      expect(item).toMatchObject({
        rootScroll: 0,
        bodyScroll: 0,
        overflow: [],
        overlaps: [],
        missing: [],
        internalClipping: [],
        controlsAccessible: true,
      });
      expect(existsSync(item.screenshot)).toBe(true);
      expect(item.drawerFocusRestored).toBe(item.viewport[0] <= 900 ? true : null);
      if (item.viewport[0] <= 900) expect(existsSync(item.drawerScreenshot!)).toBe(true);
    }
  });
});
