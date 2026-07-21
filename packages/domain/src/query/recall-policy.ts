import type { QueryIntent } from "@novel-analysis/contracts";

export interface RecallFact {
  id: string;
  chapterIndex: number;
  subjectKey: string;
  factType: string;
  body: string;
  category?: string;
  aliases?: readonly string[];
  keywords?: readonly string[];
  relatedSubjectKeys?: readonly string[];
}

export interface RecallWindow {
  windowIndex: number;
  facts: readonly RecallFact[];
}

export type RecallExclusionReason = "no_match" | "candidate_budget" | "used_budget";

export interface RankedFact extends RecallFact {
  windowIndex: number;
  rank: number;
  recallReason: "target" | "related" | "structured_match" | "coverage";
  disposition: "used" | "excluded";
  exclusionReason: RecallExclusionReason | null;
}

export interface RecallGap {
  windowIndex: number;
  reason: "no_candidates";
}

type ScoredFact = {
  fact: RecallFact;
  windowIndex: number;
  score: number;
  recallReason: RankedFact["recallReason"];
  eligible: boolean;
};

function compareFacts(left: ScoredFact, right: ScoredFact): number {
  return right.score - left.score
    || left.fact.chapterIndex - right.fact.chapterIndex
    || left.fact.id.localeCompare(right.fact.id);
}

function searchableText(fact: RecallFact): string {
  return [fact.subjectKey, fact.factType, fact.body, fact.category ?? "", ...(fact.aliases ?? []), ...(fact.keywords ?? [])].join(" ");
}

function scoreFact(intent: QueryIntent, fact: RecallFact): Pick<ScoredFact, "score" | "recallReason" | "eligible"> {
  const keywordMatches = intent.keywords.filter((keyword) => searchableText(fact).includes(keyword)).length;
  const categoryMatch = intent.categories.includes(fact.category ?? "") ? 1 : 0;

  if (intent.kind === "single-target") {
    if (fact.subjectKey === intent.target) return { score: 300, recallReason: "target", eligible: true };
    if (intent.target && fact.relatedSubjectKeys?.includes(intent.target)) return { score: 200, recallReason: "related", eligible: true };
    return { score: keywordMatches * 10 + categoryMatch, recallReason: "structured_match", eligible: false };
  }

  const structuredScore = keywordMatches * 10 + categoryMatch * 5;
  return {
    score: structuredScore,
    recallReason: structuredScore > 0 ? "structured_match" : "coverage",
    eligible: true,
  };
}

function chooseUsed(scored: readonly ScoredFact[], maxUsed: number, kind: QueryIntent["kind"]): Set<string> {
  if (maxUsed === 0) return new Set();
  if (kind === "single-target") return new Set(scored.slice(0, maxUsed).map(({ fact }) => fact.id));

  const selected: ScoredFact[] = [];
  const selectedIds = new Set<string>();
  for (const candidate of scored) {
    if (selected.some((item) => item.windowIndex === candidate.windowIndex)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.fact.id);
    if (selected.length === maxUsed) return selectedIds;
  }
  for (const candidate of scored) {
    if (selectedIds.has(candidate.fact.id)) continue;
    selectedIds.add(candidate.fact.id);
    if (selectedIds.size === maxUsed) break;
  }
  return selectedIds;
}

export function recallFacts(input: {
  intent: QueryIntent;
  windows: readonly RecallWindow[];
  maxCandidates: number;
  maxUsed: number;
}): {
  kind: QueryIntent["kind"];
  intent: QueryIntent;
  candidates: RankedFact[];
  used: RankedFact[];
  gaps: RecallGap[];
} {
  if (!Number.isSafeInteger(input.maxCandidates) || input.maxCandidates < 1
    || !Number.isSafeInteger(input.maxUsed) || input.maxUsed < 0) {
    throw new Error("Recall limits must be non-negative integers and maxCandidates must be positive");
  }

  const scored = input.windows.flatMap((window) => window.facts.map((fact) => ({
    fact,
    windowIndex: window.windowIndex,
    ...scoreFact(input.intent, fact),
  }))).sort(compareFacts);
  const eligible = scored.filter((item) => item.eligible);
  const candidateIds = chooseUsed(eligible, input.maxCandidates, input.intent.kind);
  const withinCandidateBudget = eligible.filter(({ fact }) => candidateIds.has(fact.id));
  const usedIds = chooseUsed(withinCandidateBudget, Math.min(input.maxUsed, withinCandidateBudget.length), input.intent.kind);
  const eligibleIds = new Set(eligible.map(({ fact }) => fact.id));

  const candidates = scored.map<RankedFact>((item, index) => {
    const used = usedIds.has(item.fact.id);
    const exclusionReason: RecallExclusionReason | null = used
      ? null
      : !eligibleIds.has(item.fact.id)
        ? "no_match"
        : !candidateIds.has(item.fact.id)
          ? "candidate_budget"
          : "used_budget";
    return {
      ...item.fact,
      windowIndex: item.windowIndex,
      rank: index + 1,
      recallReason: item.recallReason,
      disposition: used ? "used" : "excluded",
      exclusionReason,
    };
  });
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const used = withinCandidateBudget.filter(({ fact }) => usedIds.has(fact.id)).map(({ fact }) => byId.get(fact.id)!);
  const gaps = input.windows
    .filter((window) => !eligible.some((candidate) => candidate.windowIndex === window.windowIndex))
    .map((window) => ({ windowIndex: window.windowIndex, reason: "no_candidates" as const }));

  return { kind: input.intent.kind, intent: input.intent, candidates, used, gaps };
}
