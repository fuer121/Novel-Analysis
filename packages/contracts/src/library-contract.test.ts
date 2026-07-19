import { describe, expect, test } from "vitest";

import {
  BookSummarySchema,
  ChapterSummarySchema,
  FactReviewPageSchema,
  IndexCoverageSchema,
} from "./library-contract.js";

describe("library public contracts", () => {
  test("accepts public book, chapter, coverage and fact-review shapes", () => {
    expect(BookSummarySchema.parse({ id: crypto.randomUUID(), title: "Book", status: "active", chapterCount: 2, createdAt: new Date().toISOString() }).title).toBe("Book");
    expect(ChapterSummarySchema.parse({ id: crypto.randomUUID(), bookId: crypto.randomUUID(), chapterIndex: 1, title: "One", sourceVersion: "v1", createdAt: new Date().toISOString() }).chapterIndex).toBe(1);
    expect(IndexCoverageSchema.parse({ total: 3, fresh: 1, missing: 1, failed: 1, stale: 0 })).toEqual({ total: 3, fresh: 1, missing: 1, failed: 1, stale: 0 });
    expect(FactReviewPageSchema.parse({ facts: [], nextCursor: null })).toEqual({ facts: [], nextCursor: null });
  });

  test.each(["ciphertext", "nonce", "tag", "keyVersion", "contentHmac", "inputSignature"])("rejects internal field %s", (field) => {
    expect(() => BookSummarySchema.parse({ id: crypto.randomUUID(), title: "Book", status: "active", chapterCount: 0, createdAt: new Date().toISOString(), [field]: "secret" })).toThrow();
  });

  test("fact review metadata is a strict non-sensitive allowlist", () => {
    const fact = { id: crypto.randomUUID(), chapterId: crypto.randomUUID(), chapterIndex: 1, subjectKey: "a", factType: "event", body: "authorized", metadata: { category: "event", importance: 1, confidence: 0.5, scopeEligible: true, transformationEligible: false, scopeFieldsComplete: true }, createdAt: new Date().toISOString() };
    expect(FactReviewPageSchema.parse({ facts: [fact], nextCursor: null }).facts[0]?.metadata.category).toBe("event");
    expect(() => FactReviewPageSchema.parse({ facts: [{ ...fact, metadata: { evidence: "secret" } }], nextCursor: null })).toThrow();
  });
});
