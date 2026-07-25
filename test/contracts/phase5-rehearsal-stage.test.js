import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtinModules } from "node:module";
import test from "node:test";

const root = process.cwd();
const directory = join(root, "scripts", "phase5-rehearsal-stage");
const artifact = join(directory, "artifact", "stage.mjs");

const run = (args, inheritedFd) => spawnSync(process.execPath, [artifact, ...args], {
  cwd: root,
  encoding: "utf8",
  env: {},
  stdio: inheritedFd === undefined
    ? ["ignore", "pipe", "pipe"]
    : ["ignore", "pipe", "pipe", inheritedFd],
});

test("stage artifact rejects unknown modes and arguments without leaking values", () => {
  for (const args of [
    ["--mode", "other", "--request-fd", "3", "--result-file", "/private/result.json"],
    ["--mode", "initialize", "--request-fd", "3", "--result-file", "/private/result.json", "--extra", "credential-value"],
  ]) {
    const result = run(args);
    assert.equal(result.status, 64);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^phase5_stage_failed:(unknown_mode|unknown_argument)\n$/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /private|secret|credential-value/);
  }
});

test("stage artifact rejects inline secrets and only reports sanitized codes", () => {
  const result = run([
    "--mode", "migrate",
    "--request-fd", "3",
    "--result-file", "/private/result.json",
    "--old-key", "plaintext-key",
  ]);
  assert.equal(result.status, 64);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "phase5_stage_failed:inline_secret_forbidden\n");
  assert.doesNotMatch(result.stderr, /plaintext|private|request\.json/);
});

test("all artifact modes fail closed on malformed synthetic requests", () => {
  for (const mode of ["initialize", "migrate", "capacity"]) {
    const temporary = mkdtempSync(join(tmpdir(), "phase5-stage-contract-"));
    try {
      const request = join(temporary, "request.json");
      const resultPath = join(temporary, "result.json");
      writeFileSync(request, "not-json", { mode: 0o600 });
      const requestFd = openSync(request, "r");
      try {
        const result = run([
          "--mode", mode,
          "--request-fd", "3",
          "--result-file", resultPath,
        ], requestFd);
        assert.equal(result.status, 65);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "phase5_stage_failed:invalid_request\n");
        assert.deepEqual(JSON.parse(readFileSync(resultPath, "utf8")), {
          schemaVersion: "phase5-rehearsal-stage-result-v2",
          mode,
          status: "failed",
          code: "invalid_request",
        });
      } finally {
        closeSync(requestFd);
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
});

test("committed artifact contains the accepted migration and capacity contracts", () => {
  const bytes = readFileSync(artifact, "utf8");
  assert.match(bytes, /phase5-rehearsal-stage-result-v2/);
  assert.match(bytes, /--request-fd/);
  assert.doesNotMatch(bytes, /--request-file/);
  assert.match(bytes, /resource_mismatch/);
  for (const name of [
    "book-count", "chapter-count", "metadata", "source-integrity",
    "content-digest", "target-decrypt", "target-hmac", "scope-exclusion",
  ]) assert.match(bytes, new RegExp(JSON.stringify(name)));
  for (const value of ["phase5-local-idle-v1", "interactiveAheadOfQueuedBackground", "runningStepUninterrupted"]) {
    assert.ok(bytes.includes(value), `artifact is missing ${value}`);
  }
  assert.match(bytes, /browseP95Ms:\s*500/);
  assert.match(bytes, /submitP95Ms:\s*(?:1_?000|1e3)/);
  assert.match(bytes, /statusPropagationP95Ms:\s*(?:2_?000|2e3)/);
});

test("artifact runtime closure has no repository imports or toolchain execution", () => {
  const bytes = readFileSync(artifact, "utf8");
  const imports = bytes.split("\n").filter((line) => line.startsWith("import "));
  const executableBytes = bytes.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(imports.length > 0);
  assert.ok(imports.every((line) => / from ["']node:/.test(line)));
  assert.doesNotMatch(executableBytes, /\bimport\s*\(/);
  assert.ok(imports.every((line) => !line.includes("child_process")));
  const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
  for (const match of executableBytes.matchAll(/__require\(([^)]+)\)/g)) {
    const literal = match[1].match(/^["']([^"']+)["']$/)?.[1];
    assert.ok(literal && builtins.has(literal) && !literal.includes("child_process"));
  }
});

test("fresh builds are byte-identical to each other and committed artifact", () => {
  const committed = readFileSync(artifact);
  execFileSync(process.execPath, [join(directory, "build.mjs")], { cwd: root, stdio: "pipe" });
  const first = readFileSync(artifact);
  execFileSync(process.execPath, [join(directory, "build.mjs")], { cwd: root, stdio: "pipe" });
  const second = readFileSync(artifact);
  assert.deepEqual(first, committed);
  assert.deepEqual(second, first);
  execFileSync(process.execPath, [join(directory, "check-artifact.mjs")], { cwd: root, stdio: "pipe" });
  const expected = readFileSync(join(directory, "artifact.sha256"), "utf8").trim().split(" ")[0];
  assert.equal(createHash("sha256").update(second).digest("hex"), expected);
});

test("build inventory contains exactly one runtime artifact", () => {
  assert.deepEqual(readdirSync(join(directory, "artifact")), ["stage.mjs"]);
});
