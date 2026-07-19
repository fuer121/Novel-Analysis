import { describe, expect, it } from "vitest";

import {
  chapterImportOutput,
  emptyOutputs,
  legacyChapterImportRaw,
  legacyEnvelopeCases,
  legacyFactCategories,
  legacyL1IndexRaw,
  legacyL2IndexRaw,
  l1IndexOutput,
  l2IndexOutput,
} from "../../../test/phase2/fixtures/dify-golden.js";
import { normalizeDifyOutput } from "./dify-contract.js";

describe("Dify golden contracts", () => {
  it.each(legacyEnvelopeCases(legacyChapterImportRaw))("normalizes a legacy chapter-import payload to canonical output", (raw) => {
    expect(normalizeDifyOutput("chapter-import", raw)).toEqual({ ok: true, value: chapterImportOutput });
  });

  it.each(legacyEnvelopeCases(legacyL1IndexRaw))("normalizes a legacy l1-index payload to canonical output", (raw) => {
    expect(normalizeDifyOutput("l1-index", raw)).toEqual({ ok: true, value: l1IndexOutput });
  });

  it.each(legacyEnvelopeCases(legacyL2IndexRaw))("normalizes a legacy l2-index payload to canonical output", (raw) => {
    expect(normalizeDifyOutput("l2-index", raw)).toEqual({ ok: true, value: l2IndexOutput });
  });

  it.each(legacyFactCategories)("accepts legacy L2 fact category %s", (category) => {
    const raw = { ...legacyL2IndexRaw, facts: [{ ...legacyL2IndexRaw.facts[0], category }] };
    expect(normalizeDifyOutput("l2-index", raw)).toMatchObject({ ok: true, value: { facts: [{ category }] } });
  });

  it("returns a sanitized structured error for malformed JSON", () => {
    const secret = "provider-secret-body";
    const result = normalizeDifyOutput("l1-index", { result: `{${secret}` });
    expect(result).toEqual({ ok: false, error: { code: "MALFORMED_JSON", message: "Dify output is not valid JSON" } });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("rejects a chapter without an explicit chapter index", () => {
    const result = normalizeDifyOutput("chapter-import", {
      chapters: [{ book_id: "book-1", chapter_title: "missing", content: "body", fetch_status: "ok" }],
    });
    expect(result).toMatchObject({ ok: false, error: { code: "MISSING_CHAPTER_INDEX" } });
  });

  it("rejects L2 output without an explicit chapter index", () => {
    const missingIndex: Partial<typeof l2IndexOutput> = { ...l2IndexOutput };
    delete missingIndex.chapter_index;
    expect(normalizeDifyOutput("l2-index", missingIndex)).toMatchObject({
      ok: false,
      error: { code: "MISSING_CHAPTER_INDEX" },
    });
  });

  it.each(Object.entries(emptyOutputs))("accepts an empty %s result", (target, output) => {
    expect(normalizeDifyOutput(target as keyof typeof emptyOutputs, output)).toEqual({ ok: true, value: output });
  });

  it("rejects duplicate chapter indexes", () => {
    const duplicate = { ...chapterImportOutput.chapters[0], chapter_title: "duplicate" };
    const result = normalizeDifyOutput("chapter-import", { chapters: [chapterImportOutput.chapters[0], duplicate] });
    expect(result).toMatchObject({ ok: false, error: { code: "DUPLICATE_CHAPTER_INDEX" } });
  });

  it.each([
    ["partial numeric string", "1junk"],
    ["fractional number", 1.9],
  ])("rejects a %s chapter index without leaking the value", (_label, chapterIndex) => {
    const result = normalizeDifyOutput("chapter-import", {
      chapters: [{ chapter_index: chapterIndex, title: "chapter", content: "body" }],
    });
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_OUTPUT" } });
    expect(JSON.stringify(result)).not.toContain(String(chapterIndex));
  });

  it.each([
    ["object content", { private: "raw-body-secret" }],
    ["missing content", undefined],
  ])("rejects %s without coercing or leaking it", (_label, content) => {
    const chapter: Record<string, unknown> = { chapter_index: 1, title: "chapter" };
    if (content !== undefined) chapter.content = content;
    const result = normalizeDifyOutput("chapter-import", { chapters: [chapter] });
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_OUTPUT" } });
    expect(JSON.stringify(result)).not.toContain("raw-body-secret");
    expect(JSON.stringify(result)).not.toContain("[object Object]");
  });

  it.each([
    ["missing aliases", { aliases: undefined }],
    ["wrong aliases", { aliases: "not-an-array" }],
    ["wrong tags", { tags: { private: "raw-body-secret" } }],
    ["wrong related_entities", { related_entities: 42 }],
    ["wrong evidence", { evidence: "not-an-array" }],
    ["wrong scope boolean", { scope_eligible: "false" }],
    ["wrong transformation boolean", { transformation_eligible: 0 }],
  ])("rejects an L2 fact with %s", (_label, replacement) => {
    const fact: Record<string, unknown> = { ...legacyL2IndexRaw.facts[0], ...replacement };
    if ("aliases" in replacement && replacement.aliases === undefined) delete fact.aliases;
    const result = normalizeDifyOutput("l2-index", { ...legacyL2IndexRaw, facts: [fact] });
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_L2_FACT" } });
    expect(JSON.stringify(result)).not.toContain("raw-body-secret");
  });

  it("rejects an invalid L2 fact", () => {
    const result = normalizeDifyOutput("l2-index", {
      ...l2IndexOutput,
      facts: [{ ...l2IndexOutput.facts[0], category: "not-a-category" }],
    });
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_L2_FACT" } });
  });

  it("rejects undeclared and nested envelopes", () => {
    expect(normalizeDifyOutput("l1-index", { content: l1IndexOutput })).toMatchObject({ ok: false, error: { code: "INVALID_ENVELOPE" } });
    expect(normalizeDifyOutput("l1-index", { data: { result: l1IndexOutput } })).toMatchObject({ ok: false, error: { code: "INVALID_OUTPUT" } });
  });
});
