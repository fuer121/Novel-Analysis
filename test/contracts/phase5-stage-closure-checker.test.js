import assert from "node:assert/strict";
import test from "node:test";

import { validateArtifactClosure } from "../../scripts/phase5-rehearsal-stage/check-artifact.mjs";

const builtinOnly = 'import { readFileSync } from "node:fs";\n';

test("closure checker rejects runtime repository file loading", () => {
  assert.throws(
    () => validateArtifactClosure(`${builtinOnly}readFileSync(new URL("../../../config/indexing-baseline.json", import.meta.url));`),
    /phase5_stage_artifact_runtime_closure_invalid/,
  );
});

test("closure checker rejects unreviewed dynamic execution primitives", () => {
  for (const primitive of [
    'new Function("return process")',
    'Function("return process")()',
    'const Constructor = Function; new Constructor("return process")',
    '`${new Function("return process")}`',
    'eval("process")',
    'process.binding("fs")',
    'process.dlopen({}, "addon.node")',
    'module.createRequire("./dependency.js")',
    'new Worker("./worker.js")',
  ]) {
    assert.throws(
      () => validateArtifactClosure(`${builtinOnly}${primitive};`),
      /phase5_stage_artifact_runtime_closure_invalid/,
      primitive,
    );
  }
});
