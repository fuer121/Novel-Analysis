import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import * as viewportVerifier from "./verify-advanced-analysis-viewport.mjs";

const script = fileURLToPath(new URL("./verify-advanced-analysis-viewport.mjs", import.meta.url));

test("fails closed when a required overlap component is missing", () => {
  assert.equal(typeof viewportVerifier.validateViewportGeometry, "function");
  assert.throws(() => viewportVerifier.validateViewportGeometry(
    { width: 390, height: 760 },
    { rootScroll: 0, bodyScroll: 0, overflow: [], overlaps: [], missing: ["analysis layout"], internalClipping: [] },
  ), /required viewport components are missing/);
});

test("fails closed when navigation or result content is internally clipped", () => {
  assert.throws(() => viewportVerifier.validateViewportGeometry(
    { width: 390, height: 760 },
    { rootScroll: 0, bodyScroll: 0, overflow: [], overlaps: [], missing: [], internalClipping: ["workspace tab: 高级分析"] },
  ), /internally clipped/);
});

test("direct execution requires an explicit Playwright runtime configuration", () => {
  const env = { ...process.env };
  delete env.PLAYWRIGHT_MODULE;
  delete env.PLAYWRIGHT_CHANNEL;
  delete env.PLAYWRIGHT_EXECUTABLE_PATH;
  const result = spawnSync(process.execPath, [script], { encoding: "utf8", env });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PLAYWRIGHT_MODULE/);
});

test("viewport verifier has valid Node syntax", () => {
  const result = spawnSync(process.execPath, ["--check", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
