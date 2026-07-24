import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";

const artifact = new URL("./artifact/stage.mjs", import.meta.url);
const expected = readFileSync(new URL("./artifact.sha256", import.meta.url), "utf8")
  .trim().split(/\s+/)[0];
const bytes = readFileSync(artifact);
const actual = createHash("sha256").update(bytes).digest("hex");
if (actual !== expected) throw new Error("phase5_stage_artifact_digest_mismatch");

const source = bytes.toString("utf8");
const imports = source.split("\n").filter((line) => line.startsWith("import "));
const executableSource = source.replace(/\/\*[\s\S]*?\*\//g, "");
const requires = [...executableSource.matchAll(/__require\(([^)]+)\)/g)];
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
if (imports.some((line) => !/ from ["']node:/.test(line))
  || /\bimport\s*\(/.test(executableSource)
  || imports.some((line) => /child_process/.test(line))
  || requires.some((match) => {
    const literal = match[1].match(/^["']([^"']+)["']$/)?.[1];
    return !literal || !builtins.has(literal) || literal === "child_process" || literal === "node:child_process";
  })) {
  throw new Error("phase5_stage_artifact_runtime_closure_invalid");
}
