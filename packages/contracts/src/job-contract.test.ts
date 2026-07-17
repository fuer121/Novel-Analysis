import { describe, expect, it } from "vitest";
import {
  JobEventSchema,
  JobScopeSchema,
  PublicJobSchema,
} from "./job-contract.js";

const validJob = {
  id: "f57f4ce9-a990-40f4-bf93-452b2a4d003a",
  type: "l2-index",
  status: "running",
  requestedBy: "9d3fcceb-5fb8-4aa5-8db7-8ce32ecbca24",
  scope: {
    bookId: "215243",
    startChapter: 1,
    endChapter: 120,
    indexGroupKeys: ["items"],
    mode: "missing",
  },
  progress: {
    total: 120,
    completed: 40,
    failed: 1,
    skipped: 12,
    current: "第 53 章",
  },
  createdAt: "2026-07-16T10:00:00.000Z",
  updatedAt: "2026-07-16T10:05:00.000Z",
};

describe("job contracts", () => {
  it("accepts a complete public L2 job", () => {
    expect(PublicJobSchema.parse(validJob)).toEqual(validJob);
  });

  it("rejects a reversed chapter range", () => {
    expect(() => JobScopeSchema.parse({
      bookId: "215243",
      startChapter: 120,
      endChapter: 1,
    })).toThrow(/endChapter/);
  });

  it("rejects a book job without a book id", () => {
    expect(() => PublicJobSchema.parse({
      ...validJob,
      scope: { startChapter: 1, endChapter: 120 },
    })).toThrow();
  });

  it("accepts a migration job with migration scope", () => {
    expect(PublicJobSchema.parse({
      ...validJob,
      type: "migration",
      scope: {
        migrationId: "482723a2-92bd-47aa-aa7b-254350e92831",
        sourceLabel: "正式 SQLite 快照",
      },
    }).type).toBe("migration");
  });

  it("rejects an unknown status", () => {
    expect(() => PublicJobSchema.parse({ ...validJob, status: "waiting" })).toThrow();
  });

  it("accepts a persisted progress event", () => {
    expect(JobEventSchema.parse({
      id: 17,
      jobId: validJob.id,
      type: "progress",
      createdAt: "2026-07-16T10:05:00.000Z",
      payload: { completed: 40, total: 120 },
    }).type).toBe("progress");
  });
});
