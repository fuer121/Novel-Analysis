import { describe, expect, it } from "vitest";

import { QUERY_GOLDEN } from "../../../../test/phase3/fixtures/legacy-query-golden.js";
import { resolveQueryIntent } from "./intent.js";
import { recallFacts, type RecallFact, type RecallWindow } from "./recall-policy.js";

const knownSubjects = [{ subjectKey: "chen", displayName: "陈平安", aliases: ["平安"] }];

function fact(id: string, chapterIndex: number, overrides: Partial<RecallFact> = {}): RecallFact {
  return {
    id,
    chapterIndex,
    subjectKey: "",
    factType: "event",
    body: "普通事件",
    category: "event",
    aliases: [],
    keywords: [],
    relatedSubjectKeys: [],
    ...overrides,
  };
}

const goldenWindows: RecallWindow[] = [
  { windowIndex: 1, facts: [fact("realm-1", 10, { body: "第一境最强之人", category: "character", keywords: ["境界", "最强"] }), fact("chen-early", 20, { subjectKey: "chen", body: "陈平安早期获得飞剑" })] },
  { windowIndex: 2, facts: [fact("realm-2", 200, { body: "第二境最强之人", category: "character", keywords: ["境界", "最强"] }), fact("chen-later", 250, { subjectKey: "chen", body: "陈平安后来的飞剑发生变化", keywords: ["飞剑", "变化"] })] },
  { windowIndex: 3, facts: [fact("realm-3", 900, { body: "第三境最强之人", category: "character", keywords: ["境界", "最强"] }), fact("late-fact", 999, { subjectKey: "chen", body: "陈平安最后获得了新的飞剑", keywords: ["最后", "获得"] })] },
];

function buildGolden(question: string) {
  const intent = resolveQueryIntent({ question, recentQuestions: [], knownSubjects });
  return recallFacts({ intent, windows: goldenWindows, maxCandidates: 6, maxUsed: 3 });
}

describe("recallFacts", () => {
  it.each(QUERY_GOLDEN)("matches $name", (golden) => {
    const result = buildGolden(golden.question);
    expect(result.kind).toBe(golden.kind);
    if ("mustUse" in golden) {
      for (const id of golden.mustUse) expect(result.used.map((item) => item.id)).toContain(id);
    }
    if ("mustCoverWindows" in golden) {
      expect(new Set(result.used.map((item) => item.windowIndex))).toEqual(new Set(golden.mustCoverWindows));
    }
    if ("forbiddenTarget" in golden) expect(result.intent.target).not.toBe(golden.forbiddenTarget);
  });

  it("scans late windows before applying the global candidate limit", () => {
    const intent = resolveQueryIntent({ question: "陈平安最后获得了什么", recentQuestions: [], knownSubjects });
    const result = recallFacts({
      intent,
      windows: [
        { windowIndex: 1, facts: [fact("early-a", 1, { relatedSubjectKeys: ["chen"] }), fact("early-b", 2, { relatedSubjectKeys: ["chen"] })] },
        { windowIndex: 2, facts: [fact("late", 900, { subjectKey: "chen", body: "陈平安最后获得飞剑" })] },
      ],
      maxCandidates: 1,
      maxUsed: 1,
    });

    expect(result.used.map((item) => item.id)).toEqual(["late"]);
    expect(result.candidates.find((item) => item.id === "early-a")?.exclusionReason).toBe("candidate_budget");
  });

  it("ranks target matches before related matches with stable chapter and id ties", () => {
    const intent = resolveQueryIntent({ question: "陈平安后来如何", recentQuestions: [], knownSubjects });
    const result = recallFacts({
      intent,
      windows: [{ windowIndex: 1, facts: [
        fact("related", 1, { relatedSubjectKeys: ["chen"] }),
        fact("target-b", 3, { subjectKey: "chen" }),
        fact("target-a", 3, { subjectKey: "chen" }),
      ] }],
      maxCandidates: 3,
      maxUsed: 3,
    });

    expect(result.used.map((item) => item.id)).toEqual(["target-a", "target-b", "related"]);
  });

  it("keeps target facts ahead of related facts regardless of keyword count", () => {
    const keywords = Array.from({ length: 11 }, (_, index) => `keyword-${index}`);
    const result = recallFacts({
      intent: { kind: "single-target", target: "chen", aliases: [], referents: [], categories: [], keywords },
      windows: [{ windowIndex: 1, facts: [
        fact("related", 1, { relatedSubjectKeys: ["chen"], body: keywords.join(" ") }),
        fact("target", 2, { subjectKey: "chen" }),
      ] }],
      maxCandidates: 2,
      maxUsed: 2,
    });

    expect(result.used.map((item) => item.id)).toEqual(["target", "related"]);
  });

  it("applies candidate and used limits after considering every fact and explains every exclusion", () => {
    const intent = resolveQueryIntent({ question: "有哪些事件", recentQuestions: [], knownSubjects });
    const result = recallFacts({
      intent,
      windows: [{ windowIndex: 1, facts: [fact("a", 1), fact("b", 2), fact("c", 3)] }],
      maxCandidates: 2,
      maxUsed: 1,
    });

    expect(result.used.map((item) => item.id)).toEqual(["a"]);
    expect(result.candidates.map(({ id, exclusionReason }) => [id, exclusionReason])).toEqual([
      ["a", null],
      ["b", "used_budget"],
      ["c", "candidate_budget"],
    ]);
    expect(result.candidates.filter((item) => item.disposition === "excluded").every((item) => item.exclusionReason)).toBe(true);
  });

  it("applies a collection candidate budget across windows", () => {
    const intent = resolveQueryIntent({ question: "有哪些事件", recentQuestions: [], knownSubjects });
    const result = recallFacts({
      intent,
      windows: [
        { windowIndex: 1, facts: [fact("early-a", 1), fact("early-b", 2)] },
        { windowIndex: 2, facts: [fact("late", 900)] },
      ],
      maxCandidates: 2,
      maxUsed: 2,
    });

    expect(result.used.map((item) => item.id)).toEqual(["early-a", "late"]);
    expect(result.candidates.find((item) => item.id === "early-b")?.exclusionReason).toBe("candidate_budget");
  });

  it("supports an explicit zero used budget", () => {
    const intent = resolveQueryIntent({ question: "有哪些事件", recentQuestions: [], knownSubjects });
    const result = recallFacts({ intent, windows: [{ windowIndex: 1, facts: [fact("a", 1)] }], maxCandidates: 1, maxUsed: 0 });
    expect(result.used).toEqual([]);
    expect(result.candidates[0]?.exclusionReason).toBe("used_budget");
  });

  it("rejects duplicate fact IDs across windows", () => {
    const intent = resolveQueryIntent({ question: "有哪些事件", recentQuestions: [], knownSubjects });
    expect(() => recallFacts({
      intent,
      windows: [
        { windowIndex: 1, facts: [fact("duplicate", 1)] },
        { windowIndex: 2, facts: [fact("duplicate", 2)] },
      ],
      maxCandidates: 1,
      maxUsed: 1,
    })).toThrow("Duplicate recall fact ID");
  });

  it("marks nonmatching facts and empty windows explicitly", () => {
    const intent = resolveQueryIntent({ question: "陈平安的飞剑", recentQuestions: [], knownSubjects });
    const result = recallFacts({
      intent,
      windows: [{ windowIndex: 1, facts: [fact("unrelated", 1)] }, { windowIndex: 2, facts: [] }],
      maxCandidates: 2,
      maxUsed: 1,
    });

    expect(result.candidates[0]).toMatchObject({ id: "unrelated", disposition: "excluded", exclusionReason: "no_match" });
    expect(result.gaps).toEqual([{ windowIndex: 1, reason: "no_candidates" }, { windowIndex: 2, reason: "no_candidates" }]);
  });

  it.each([{ maxCandidates: 0, maxUsed: 1 }, { maxCandidates: 1, maxUsed: -1 }, { maxCandidates: 1.5, maxUsed: 1 }])(
    "rejects invalid limits %#",
    (limits) => expect(() => recallFacts({ intent: resolveQueryIntent({ question: "事件", recentQuestions: [], knownSubjects }), windows: [], ...limits })).toThrow("Recall limits"),
  );
});
