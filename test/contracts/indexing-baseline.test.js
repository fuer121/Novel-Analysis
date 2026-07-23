import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  INDEXING_BASELINE_PATH,
  validateIndexingBaseline,
} from "../../scripts/check-indexing-baseline.mjs";

const EXPECTED_L1_PROMPT = "请为当前小说章节建立轻量 L1 章节路由/信号索引。\n定位：L1 只判断本章有哪些可召回信号，服务后续按章节命中后读取 L2 专项事实；不要写长摘要，不要沉淀事实卡，不要替代 L2。\n要求：只依据本章原文；不要输出 Markdown；不要引用长段原文；主体、别名、关键词和分类信号要稳定、短句化、便于检索。";
const EXPECTED_L2_PROMPT = "请为当前小说章节建立 L2 类型化事实索引。\n目标：提取可复用、可检索、可追溯的事实单元，不要写长摘要，不要输出 Markdown。\n分类只能使用：character、relationship、cultivation、force、event、item、magical_creature、location、foreshadowing、other、organization、power、mystery。\n每条事实必须短而明确，保留主体、相关主体、事实类型、重要度、置信度和少量证据摘记。\n不要补充本章原文之外的信息；如果本章没有可复用事实，facts 输出空数组。";

test("repository indexing baseline is exact and bound to the workflow manifest", async () => {
  const baseline = JSON.parse(await readFile(INDEXING_BASELINE_PATH, "utf8"));
  const validated = await validateIndexingBaseline(baseline);
  assert.equal(validated.version, "phase5-indexing-v1");
  assert.equal(validated.l1.prompt, EXPECTED_L1_PROMPT);
  assert.equal(validated.l2.prompt, EXPECTED_L2_PROMPT);
});

test("strict baseline validation rejects unknown fields and semantic drift", async () => {
  const baseline = JSON.parse(await readFile(INDEXING_BASELINE_PATH, "utf8"));
  await assert.rejects(
    validateIndexingBaseline({ ...baseline, legacyPrompt: "forbidden" }),
    /unknown field/i,
  );
  await assert.rejects(
    validateIndexingBaseline({
      ...baseline,
      l2: {
        ...baseline.l2,
        baseGroup: { ...baseline.l2.baseGroup, categoryScope: "magical_creature" },
      },
    }),
    /categoryScope/i,
  );
  await assert.rejects(
    validateIndexingBaseline({
      ...baseline,
      l1: { ...baseline.l1, dslSha256: "0".repeat(64) },
    }),
    /manifest/i,
  );
});
