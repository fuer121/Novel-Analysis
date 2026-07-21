import { describe, expect, it } from "vitest";

import { resolveQueryIntent } from "./intent.js";

const subjects = [
  { subjectKey: "chen", displayName: "陈平安", aliases: ["平安"] },
  { subjectKey: "ning", displayName: "宁姚", aliases: [] },
];

describe("resolveQueryIntent", () => {
  it("resolves a pronoun from recent questions without accepting prior answers", () => {
    const intent = resolveQueryIntent({
      question: "他后来有什么变化？",
      recentQuestions: ["陈平安第一次获得飞剑是什么时候？"],
      knownSubjects: subjects,
    });

    expect(intent).toMatchObject({ kind: "single-target", target: "chen", referents: ["他"] });
    expect(JSON.stringify(intent)).not.toContain("上一轮模型回答");
  });

  it("does not expose prior answers as a type or runtime input", () => {
    // @ts-expect-error prior answers are intentionally outside the intent boundary
    const typedIntent = resolveQueryIntent({ question: "他是谁？", recentQuestions: [], knownSubjects: subjects, previousAnswers: ["上一轮模型回答说他是陈平安"] });
    const runtimeIntent = resolveQueryIntent({
      question: "他是谁？",
      recentQuestions: [],
      knownSubjects: subjects,
      previousAnswers: ["上一轮模型回答说他是陈平安"],
    } as Parameters<typeof resolveQueryIntent>[0]);

    expect(typedIntent.target).toBeNull();
    expect(runtimeIntent.target).toBeNull();
    expect(JSON.stringify(runtimeIntent)).not.toContain("上一轮模型回答");
  });

  it("uses only the latest three user questions when resolving a pronoun", () => {
    const intent = resolveQueryIntent({
      question: "他后来怎么样？",
      recentQuestions: ["陈平安是谁？", "天气如何？", "这一章讲什么？", "有什么伏笔？"],
      knownSubjects: subjects,
    });

    expect(intent).toMatchObject({ kind: "general", target: null });
  });

  it("prefers an explicit subject in the current question", () => {
    expect(resolveQueryIntent({
      question: "平安后来的飞剑有什么变化？",
      recentQuestions: ["宁姚去了哪里？"],
      knownSubjects: subjects,
    })).toMatchObject({ kind: "single-target", target: "chen", aliases: ["平安"] });
  });

  it.each([
    ["各境界最强的人分别是谁", "collection"],
    ["有哪些重要法宝", "collection"],
    ["这本书埋了什么伏笔", "general"],
  ] as const)("classifies %s as %s", (question, kind) => {
    const intent = resolveQueryIntent({ question, recentQuestions: [], knownSubjects: subjects });
    expect(intent.kind).toBe(kind);
    expect(intent.target).toBeNull();
  });
});
