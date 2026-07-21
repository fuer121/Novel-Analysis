import { describe, expect, it } from "vitest";
import {
  QueryEvidenceSchema,
  QueryIntentSchema,
  QuerySessionSchema,
  QueryTurnDetailSchema,
  QueryTurnHistoryPageSchema,
  QueryTurnSchema,
} from "./query-contract.js";

const ids = {
  session: "00000000-0000-4000-8000-000000000001",
  turn: "00000000-0000-4000-8000-000000000002",
  user: "00000000-0000-4000-8000-000000000003",
  book: "00000000-0000-4000-8000-000000000004",
  group: "00000000-0000-4000-8000-000000000005",
  fact: "00000000-0000-4000-8000-000000000006",
};

describe("query contracts", () => {
  it.each([
    { fact: "旧回答里的结论" },
    { answer: "旧回答正文" },
    { unexpected: true },
  ])("rejects facts, answers and unknown intent keys", (extra) => {
    expect(QueryIntentSchema.safeParse({
      kind: "single-target",
      target: "陈平安",
      aliases: [],
      referents: ["他"],
      categories: [],
      keywords: [],
      ...extra,
    }).success).toBe(false);
  });

  it.each(["awaiting_fallback", "degraded"] as const)(
    "exposes the %s turn status",
    (status) => {
      const parsed = QueryTurnSchema.parse({
        id: ids.turn,
        sessionId: ids.session,
        createdBy: ids.user,
        question: "之后发生了什么？",
        startChapter: 420,
        endChapter: 860,
        status,
        answer: null,
        degradation: status === "degraded" ? "local_summary" : null,
        sourceStats: { candidates: 12, used: 8, excluded: 4, gaps: 1 },
      });

      expect(parsed.status).toBe(status);
    },
  );

  it("exposes session visibility, default chapter range and management permission", () => {
    const parsed = QuerySessionSchema.parse({
      id: ids.session,
      bookId: ids.book,
      groupId: ids.group,
      createdBy: ids.user,
      title: "剑来人物研究",
      visibility: "team",
      defaultStartChapter: 420,
      defaultEndChapter: 860,
      canManage: true,
      archivedAt: null,
    });

    expect(parsed).toMatchObject({
      visibility: "team",
      defaultStartChapter: 420,
      defaultEndChapter: 860,
      canManage: true,
    });
  });

  it("exposes evidence content, ranking and recall disposition", () => {
    const parsed = QueryEvidenceSchema.parse({
      turnId: ids.turn,
      factId: ids.fact,
      chapterIndex: 688,
      body: "陈平安在此章返回小镇",
      rank: 2,
      recallReason: "target_alias",
      disposition: "excluded",
      exclusionReason: "candidate_budget",
    });

    expect(parsed).toEqual({
      turnId: ids.turn,
      factId: ids.fact,
      chapterIndex: 688,
      body: "陈平安在此章返回小镇",
      rank: 2,
      recallReason: "target_alias",
      disposition: "excluded",
      exclusionReason: "candidate_budget",
    });
  });

  it("strictly exposes safe trace fields in history without evidence", () => {
    const parsed = QueryTurnHistoryPageSchema.parse({
      turns: [{
        id: ids.turn,
        sessionId: ids.session,
        createdBy: ids.user,
        question: "之后发生了什么？",
        startChapter: 420,
        endChapter: 860,
        status: "completed",
        answer: "他返回了小镇",
        degradation: null,
        sourceStats: { candidates: 12, used: 8, excluded: 4, gaps: 1 },
        trace: {
          kind: "single-target",
          target: "陈平安",
          aliases: ["陈好人"],
          referents: ["他"],
          categories: ["人物"],
          keywords: ["小镇"],
          sourceCounts: { candidates: 12, used: 8, excluded: 4 },
          gapCount: 1,
          recallPolicyVersion: "query-recall-v1",
          summaryWorkflowVersion: "summary-v1",
        },
      }],
      nextCursor: "opaque",
    });

    expect(parsed.turns[0]).not.toHaveProperty("evidence");
    expect(parsed.turns[0]!.trace).not.toHaveProperty("executionSignature");
    expect(parsed.turns[0]!.trace).not.toHaveProperty("questionHmac");
    expect(parsed.turns[0]!.trace).not.toHaveProperty("evidenceSnapshotHash");
  });

  it("represents queued empty snapshots without fabricated trace values", () => {
    const parsed = QueryTurnDetailSchema.parse({
      id: ids.turn,
      sessionId: ids.session,
      createdBy: ids.user,
      question: "之后发生了什么？",
      startChapter: 420,
      endChapter: 860,
      status: "queued",
      answer: null,
      degradation: null,
      sourceStats: { candidates: 0, used: 0, excluded: 0, gaps: 0 },
      trace: {
        kind: null,
        target: null,
        aliases: [],
        referents: [],
        categories: [],
        keywords: [],
        sourceCounts: { candidates: 0, used: 0, excluded: 0 },
        gapCount: 0,
        recallPolicyVersion: null,
        summaryWorkflowVersion: null,
      },
      evidence: [],
    });

    expect(parsed.trace.kind).toBeNull();
    expect(parsed.trace.recallPolicyVersion).toBeNull();
  });

  it.each(["executionSignature", "questionHmac", "evidenceSnapshotHash", "jobId", "attemptId", "rawSnapshot", "providerError", "credential"])(
    "rejects the unsafe trace key %s",
    (key) => {
      const result = QueryTurnHistoryPageSchema.safeParse({
        turns: [{
          id: ids.turn, sessionId: ids.session, createdBy: ids.user,
          question: "问题", startChapter: 1, endChapter: 2, status: "queued",
          answer: null, degradation: null,
          sourceStats: { candidates: 0, used: 0, excluded: 0, gaps: 0 },
          trace: {
            kind: null, target: null, aliases: [], referents: [], categories: [], keywords: [],
            sourceCounts: { candidates: 0, used: 0, excluded: 0 }, gapCount: 0,
            recallPolicyVersion: null, summaryWorkflowVersion: null,
            [key]: "SENTINEL",
          },
        }],
        nextCursor: null,
      });
      expect(result.success).toBe(false);
    },
  );
});
