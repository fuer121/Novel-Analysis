import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

process.env.DIFY_API_BASE = "http://127.0.0.1:9999/v1";
process.env.DIFY_CHAPTER_WORKFLOW_API_KEY = "app-contract";

const dify = await import("../../server/dify.js");

async function fixture(name) {
  return JSON.parse(await fs.readFile(new URL(`../fixtures/dify/${name}.json`, import.meta.url), "utf8"));
}

test("legacy chapter normalization remains a new-adapter contract", async () => {
  const chapters = dify.normalizeDifyChapterOutput(
    await fixture("chapter-output"),
    { bookId: "215243", startChapter: 31, endChapter: 32 },
  );
  assert.deepEqual(chapters.map((chapter) => chapter.chapter_index), [31, 32]);
  assert.deepEqual(chapters.map((chapter) => chapter.chapter_title), ["剑匣", "飞剑"]);
});

test("legacy L1 normalization remains a new-adapter contract", async () => {
  const output = dify.normalizeDifyL1Output(await fixture("l1-output"));
  assert.equal(output.route_schema_version, "l1-route-v1");
  assert.equal(output.route_entities[0].name, "宁姚");
  assert.equal(output.category_scores.item, 0.9);
});

test("legacy L2 normalization remains a new-adapter contract", async () => {
  const output = dify.normalizeDifyL2Output(await fixture("l2-output"));
  assert.equal(output.chapter_index, 31);
  assert.equal(output.facts.length, 1);
  assert.equal(output.facts[0].entity, "剑匣");
  assert.equal(output.facts[0].category, "item");
});
