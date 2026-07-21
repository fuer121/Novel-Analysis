import type { QueryIntent } from "@novel-analysis/contracts";

export interface KnownSubject {
  subjectKey: string;
  displayName: string;
  aliases: readonly string[];
}

const COLLECTION_PATTERN = /哪些|有哪些|分别|各(?:个|类|境|境界)?|所有|列出|盘点|汇总/;
const PRONOUN_PATTERN = /他|她|它|其|这个人|此人/g;
const KEYWORD_PATTERN = /飞剑|法宝|境界|最强|变化|获得|最后|后来|伏笔|人物|事件|身份|关系|去向|结局/g;
const CATEGORY_TERMS = ["character", "item", "event", "relationship"] as const;

function findSubject(text: string, subjects: readonly KnownSubject[]): { subject: KnownSubject; matched: string } | undefined {
  for (const subject of subjects) {
    const names = [subject.displayName, ...subject.aliases]
      .map((name) => name.trim())
      .filter(Boolean)
      .sort((left, right) => right.length - left.length);
    const matched = names.find((name) => text.includes(name));
    if (matched) return { subject, matched };
  }
  return undefined;
}

function categoriesFor(question: string): string[] {
  const categories: string[] = [];
  if (/人|人物|角色|谁/.test(question)) categories.push(CATEGORY_TERMS[0]);
  if (/法宝|飞剑|物品|兵器/.test(question)) categories.push(CATEGORY_TERMS[1]);
  if (/事件|发生|经历/.test(question)) categories.push(CATEGORY_TERMS[2]);
  if (/关系/.test(question)) categories.push(CATEGORY_TERMS[3]);
  return categories;
}

export function resolveQueryIntent(input: {
  question: string;
  recentQuestions: readonly string[];
  knownSubjects: readonly KnownSubject[];
}): QueryIntent {
  const question = input.question.trim();
  const collection = COLLECTION_PATTERN.test(question);
  const explicit = findSubject(question, input.knownSubjects);
  const referents = [...new Set(question.match(PRONOUN_PATTERN) ?? [])];
  let resolved = explicit;

  if (!resolved && !collection && referents.length > 0) {
    const recentQuestions = input.recentQuestions.slice(-3);
    for (let index = recentQuestions.length - 1; index >= 0 && !resolved; index -= 1) {
      resolved = findSubject(recentQuestions[index] ?? "", input.knownSubjects);
    }
  }

  return {
    kind: resolved ? "single-target" : collection ? "collection" : "general",
    target: resolved?.subject.subjectKey ?? null,
    aliases: explicit && explicit.matched !== explicit.subject.displayName ? [explicit.matched] : [],
    referents,
    categories: categoriesFor(question),
    keywords: [...new Set(question.match(KEYWORD_PATTERN) ?? [])],
  };
}
