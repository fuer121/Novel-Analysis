import { describe, expect, it } from "vitest";
import {
  BookJobScopeSchema,
  JobEventSchema,
  JobListQuerySchema,
  JobListResponseSchema,
  JobProgressSchema,
  JobResponseSchema,
  JobScopeSchema,
  PublicJobSchema,
} from "./job-contract.js";
import type { JobProgress } from "./job-contract.js";

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

const validProgress: JobProgress = validJob.progress;

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

  it("rejects an empty index group selection", () => {
    expect(() => BookJobScopeSchema.parse({
      bookId: "215243",
      indexGroupKeys: [],
    })).toThrow();
  });

  it("rejects an empty explicit chapter selection", () => {
    expect(() => BookJobScopeSchema.parse({
      bookId: "215243",
      chapterIndexes: [],
    })).toThrow();
  });

  it("rejects a misspelled scope field", () => {
    expect(() => BookJobScopeSchema.parse({
      bookId: "215243",
      startChaper: 1,
    })).toThrow();
  });

  it("rejects migration fields mixed into a book scope", () => {
    expect(() => PublicJobSchema.parse({
      ...validJob,
      scope: {
        bookId: "215243",
        migrationId: "482723a2-92bd-47aa-aa7b-254350e92831",
        sourceLabel: "正式 SQLite 快照",
      },
    })).toThrow();
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

  it("accepts a persisted resume control event", () => {
    expect(JobEventSchema.parse({
      id: 18,
      jobId: validJob.id,
      type: "resumed",
      createdAt: "2026-07-16T10:06:00.000Z",
      payload: { from: "paused", to: "queued" },
    }).type).toBe("resumed");
  });

  it("exposes the inferred job progress type", () => {
    expect(validProgress.completed).toBe(40);
  });

  it("rejects progress counts that exceed the total", () => {
    expect(() => JobProgressSchema.parse({
      total: 3,
      completed: 2,
      failed: 1,
      skipped: 1,
      current: "第 4 章",
    })).toThrow(/total/);
  });

  it("bounds list limits and accepts an optional cursor", () => {
    expect(JobListQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(JobListQuerySchema.parse({ limit: "100", cursor: "cursor-1" }))
      .toEqual({ limit: 100, cursor: "cursor-1" });
    expect(() => JobListQuerySchema.parse({ limit: "101" })).toThrow();
    expect(() => JobListQuerySchema.parse({ limit: "0" })).toThrow();
  });

  it("defines public detail and list response envelopes", () => {
    expect(JobResponseSchema.parse({ job: validJob })).toEqual({ job: validJob });
    expect(JobListResponseSchema.parse({ jobs: [validJob], nextCursor: null }))
      .toEqual({ jobs: [validJob], nextCursor: null });
  });

  it("strips internal persistence fields from public jobs", () => {
    expect(JobResponseSchema.parse({
      job: {
        ...validJob,
        requestId: "private-request-id",
        configSnapshot: { internal: true },
        leaseOwner: "worker-1",
        queueId: "queue-1",
        tokenHash: "secret",
        errorStack: "private stack",
      },
    })).toEqual({ job: validJob });
  });
});
