import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const INDEXING_BASELINE_PATH = path.join(ROOT, "config/indexing-baseline.json");
const MANIFEST_PATH = path.join(ROOT, "dify-workflows/manifest.json");

const L1_PROMPT = "请为当前小说章节建立轻量 L1 章节路由/信号索引。\n定位：L1 只判断本章有哪些可召回信号，服务后续按章节命中后读取 L2 专项事实；不要写长摘要，不要沉淀事实卡，不要替代 L2。\n要求：只依据本章原文；不要输出 Markdown；不要引用长段原文；主体、别名、关键词和分类信号要稳定、短句化、便于检索。";
const L2_PROMPT = "请为当前小说章节建立 L2 类型化事实索引。\n目标：提取可复用、可检索、可追溯的事实单元，不要写长摘要，不要输出 Markdown。\n分类只能使用：character、relationship、cultivation、force、event、item、magical_creature、location、foreshadowing、other、organization、power、mystery。\n每条事实必须短而明确，保留主体、相关主体、事实类型、重要度、置信度和少量证据摘记。\n不要补充本章原文之外的信息；如果本章没有可复用事实，facts 输出空数组。";

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`${label} contains an unknown field`);
  }
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export async function validateIndexingBaseline(value) {
  exactKeys(value, ["version", "l1", "l2"], "baseline");
  exactKeys(value.l1, ["promptVersion", "prompt", "adapterContractVersion", "dslSha256"], "l1");
  exactKeys(value.l2, ["promptVersion", "prompt", "adapterContractVersion", "dslSha256", "baseGroup"], "l2");
  exactKeys(value.l2.baseGroup, ["key", "name", "categoryScope"], "l2.baseGroup");
  if (value.version !== "phase5-indexing-v1"
    || value.l1.promptVersion !== "phase5-l1-v1"
    || value.l1.prompt !== L1_PROMPT
    || value.l1.adapterContractVersion !== "l1-route-v1"
    || value.l2.promptVersion !== "phase5-l2-v1"
    || value.l2.prompt !== L2_PROMPT
    || value.l2.adapterContractVersion !== "l2-fact-v1") {
    throw new Error("Indexing baseline identity drift");
  }
  if (value.l2.baseGroup.key !== "base"
    || value.l2.baseGroup.name !== "基础事实"
    || value.l2.baseGroup.categoryScope !== "general") {
    throw new Error("Invalid baseGroup categoryScope or identity");
  }
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  if (value.l1.dslSha256 !== manifest.workflows?.l1_index?.sha256
    || value.l2.dslSha256 !== manifest.workflows?.l2_index?.sha256) {
    throw new Error("Indexing baseline does not match workflow manifest");
  }
  return {
    ...value,
    l1: { ...value.l1, promptSha256: sha256(value.l1.prompt) },
    l2: { ...value.l2, promptSha256: sha256(value.l2.prompt) },
  };
}

export async function loadIndexingBaseline() {
  return validateIndexingBaseline(JSON.parse(await readFile(INDEXING_BASELINE_PATH, "utf8")));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await loadIndexingBaseline();
  process.stdout.write("Indexing baseline OK\n");
}
