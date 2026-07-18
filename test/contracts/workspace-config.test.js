import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

async function readJson(url) {
  try {
    return JSON.parse(await fs.readFile(url, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

const packageJsonUrl = new URL("../../package.json", import.meta.url);
const tsconfigUrl = new URL("../../tsconfig.base.json", import.meta.url);

test("root package declares the new workspace without moving the legacy app", async () => {
  const packageJson = await readJson(packageJsonUrl);
  assert.deepEqual(packageJson.workspaces, ["apps/*", "packages/*"]);
  assert.equal(packageJson.scripts["test:legacy"], "node --test test/service.test.js");
  assert.equal(packageJson.scripts["test:new"], "vitest run");
  assert.equal(
    packageJson.scripts["test:project-source"],
    "node --test test/project-source-of-truth.test.js",
  );
  assert.equal(packageJson.scripts["project:check"], "node scripts/check-project-source.mjs");
  assert.equal(
    packageJson.scripts.verify,
    "npm run verify:legacy && npm run verify:new && npm run dify:manifest:check && npm run test:project-source && npm run project:check",
  );
  assert.equal(
    packageJson.scripts["typecheck:new"],
    "tsc -p packages/contracts/tsconfig.json && tsc -p packages/domain/tsconfig.json",
  );
});

test("TypeScript baseline is strict and emits no JavaScript during verification", async () => {
  const tsconfig = await readJson(tsconfigUrl);
  assert.ok(tsconfig, "tsconfig.base.json must exist");
  assert.equal(tsconfig.compilerOptions.strict, true);
  assert.equal(tsconfig.compilerOptions.noEmit, true);
  assert.equal(tsconfig.compilerOptions.module, "NodeNext");
  assert.equal(tsconfig.compilerOptions.moduleResolution, "NodeNext");
});
