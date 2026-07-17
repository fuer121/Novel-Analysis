import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.DIFY_API_BASE = "http://127.0.0.1:9999/v1";
process.env.DIFY_CHAPTER_WORKFLOW_API_KEY = "app-contract";
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "novel-dify-contract-"));
process.env.DATA_DIR = tempDir;

const dify = await import("../../server/dify.js");

test.after(async () => fs.rm(tempDir, { recursive: true, force: true }));

async function fixture(name) {
  return JSON.parse(await fs.readFile(new URL(`../fixtures/dify/${name}.json`, import.meta.url), "utf8"));
}

test("legacy chapter normalization remains a new-adapter contract", async () => {
  const chapters = dify.normalizeDifyChapterOutput(
    await fixture("chapter-output"),
    { bookId: "215243", startChapter: 31, endChapter: 32 },
  );
  assert.deepEqual(chapters, [
    {
      book_id: "215243",
      chapter_index: 31,
      chapter_title: "剑匣",
      content: "宁姚取出剑匣。",
      fetch_status: "ok",
    },
    {
      book_id: "215243",
      chapter_index: 32,
      chapter_title: "飞剑",
      content: "一柄飞剑掠空而过。",
      fetch_status: "ok",
    },
  ]);
});

test("legacy L1 normalization remains a new-adapter contract", async () => {
  const output = dify.normalizeDifyL1Output(await fixture("l1-output"));
  assert.deepEqual(output, {
    route_schema_version: "l1-route-v1",
    route_entities: [
      {
        name: "宁姚",
        type: "character",
        aliases: [],
        role: "核心人物",
        note: "持剑者",
      },
    ],
    route_keywords: ["宁姚", "飞剑"],
    signals: [
      {
        category: "item",
        strength: 0.9,
        entities: ["宁姚"],
        keywords: ["飞剑"],
        reason: "关键物件",
      },
    ],
    category_scores: {
      character: 0,
      relationship: 0,
      cultivation: 0,
      force: 0,
      item: 0.9,
      magical_creature: 0,
      location: 0,
      event: 0,
      foreshadowing: 0,
      other: 0,
    },
  });
});

test("legacy L2 normalization remains a new-adapter contract", async () => {
  const output = dify.normalizeDifyL2Output(await fixture("l2-output"));
  assert.deepEqual(output, {
    chapter_index: 31,
    chapter_title: "剑匣",
    facts: [
      {
        category: "item",
        entity: "剑匣",
        aliases: [],
        tags: ["武器"],
        related_entities: ["宁姚"],
        fact_type: "ownership",
        fact: "宁姚持有剑匣。",
        evidence: ["宁姚取出剑匣"],
        importance: 0.8,
        confidence: 0.9,
        scope_eligible: false,
        scope_basis: "",
        transformation_eligible: false,
        scope_fields_complete: false,
        creature_type: "",
        original_form: "",
        qualification_evidence: [],
        subject_key: "",
        identity_basis: "",
      },
    ],
  });
});
