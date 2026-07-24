import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { pathToFileURL } from "node:url";

const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

function codeOnly(source) {
  let result = "";
  let state = "code";
  let templateExpressionDepth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (state === "code") {
      if (current === "/" && next === "*") { state = "block"; result += "  "; index += 1; continue; }
      if (current === "/" && next === "/") { state = "line"; result += "  "; index += 1; continue; }
      if (current === '"') { state = "double"; result += '""'; continue; }
      if (current === "'") { state = "single"; result += "''"; continue; }
      if (current === "`") { state = "template"; result += "``"; continue; }
      if (templateExpressionDepth > 0 && current === "{") templateExpressionDepth += 1;
      if (templateExpressionDepth > 0 && current === "}") {
        templateExpressionDepth -= 1;
        if (templateExpressionDepth === 0) state = "template";
      }
      result += current;
      continue;
    }
    if (state === "line" && current === "\n") { state = "code"; result += "\n"; continue; }
    if (state === "block" && current === "*" && next === "/") { state = "code"; result += "  "; index += 1; continue; }
    if (state === "template" && current === "$" && next === "{") {
      state = "code";
      templateExpressionDepth = 1;
      result += "${";
      index += 1;
      continue;
    }
    if ((state === "single" && current === "'")
      || (state === "double" && current === '"')
      || (state === "template" && current === "`")) {
      state = "code";
      continue;
    }
    if (["single", "double", "template"].includes(state) && current === "\\") index += 1;
    if (current === "\n") result += "\n";
  }
  return result;
}

export function validateArtifactClosure(source) {
  const imports = source.split("\n").filter((line) => line.startsWith("import "));
  const executableSource = codeOnly(source);
  const commentlessSource = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const requires = [...commentlessSource.matchAll(/__require\(([^)]+)\)/g)];
  const functionAliases = [...executableSource.matchAll(
    /\b(?:const|let|var)\s+([$\w]+)\s*=\s*Function\b(?!\s*\.)/g,
  )].map((match) => match[1]);
  const findings = {
    nonBuiltinImport: imports.some((line) => !/ from ["']node:/.test(line)),
    dangerousBuiltin: imports.some((line) => /child_process|worker_threads|node:vm/.test(line)),
    dynamicImport: /\bimport\s*\(/.test(executableSource),
    functionConstructor: /(?:\bnew\s+)?(?<![$\w])Function\s*\(/.test(executableSource)
      || functionAliases.some((alias) => new RegExp(`(?:\\bnew\\s+)?\\b${alias.replaceAll("$", "\\$")}\\s*\\(`).test(executableSource)),
    eval: /\beval\s*\(/.test(executableSource),
    processPrimitive: /\bprocess\s*\.\s*(?:binding|dlopen)\s*\(/.test(executableSource),
    moduleCreateRequire: /\bmodule\s*\.\s*createRequire\s*\(/.test(executableSource),
    pathWorker: /\b(?:globalThis\s*\.\s*)?Worker\s*\(\s*["'`]/.test(commentlessSource),
    repositoryUrl: /new\s+URL\s*\(\s*["'](?:\.{1,2}\/|\/)[^"']*["']\s*,\s*import\.meta\.url/.test(commentlessSource),
    staticFileRead: /\b(?:readFile|readFileSync)\s*\(\s*["'](?:\.{1,2}\/|\/)/.test(commentlessSource),
    baselineLoader: /indexing-baseline\.json|\bBASELINE_URL\b/.test(source),
    unresolvedRequire: requires.some((match) => {
    const literal = match[1].match(/^["']([^"']+)["']$/)?.[1];
    return !literal || !builtins.has(literal) || literal === "child_process" || literal === "node:child_process";
    }),
  };
  const active = Object.entries(findings).filter(([, found]) => found).map(([name]) => name);
  if (active.length > 0) {
    throw new Error(`phase5_stage_artifact_runtime_closure_invalid:${active.join(",")}`);
  }
}

function checkCommittedArtifact() {
  const artifact = new URL("./artifact/stage.mjs", import.meta.url);
  const expected = readFileSync(new URL("./artifact.sha256", import.meta.url), "utf8")
    .trim().split(/\s+/)[0];
  const bytes = readFileSync(artifact);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new Error("phase5_stage_artifact_digest_mismatch");
  validateArtifactClosure(bytes.toString("utf8"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkCommittedArtifact();
}
