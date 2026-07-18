import { describe, expect, it } from "vitest";
import { JOB_STATUSES } from "@novel-analysis/contracts";
import type { JobStatus } from "@novel-analysis/contracts";
import {
  InvalidJobTransitionError,
  assertJobTransition,
  canTransitionJob,
} from "./job-state.js";

const allowedTransitions = [
  ["queued", "running"],
  ["queued", "paused"],
  ["queued", "cancelled"],
  ["running", "retrying"],
  ["running", "paused"],
  ["running", "completed"],
  ["running", "failed"],
  ["running", "cancelled"],
  ["retrying", "running"],
  ["retrying", "paused"],
  ["retrying", "failed"],
  ["retrying", "cancelled"],
  ["paused", "queued"],
  ["paused", "running"],
  ["paused", "cancelled"],
] as const satisfies ReadonlyArray<readonly [JobStatus, JobStatus]>;

const allowedTransitionKeys = new Set(
  allowedTransitions.map(([from, to]) => `${from}:${to}`),
);

const rejectedTransitions = JOB_STATUSES.flatMap((from) => (
  JOB_STATUSES
    .filter((to) => !allowedTransitionKeys.has(`${from}:${to}`))
    .map((to) => [from, to] as const)
));

describe("job state transitions", () => {
  it("covers the complete 7 by 7 transition matrix", () => {
    expect(allowedTransitions).toHaveLength(15);
    expect(rejectedTransitions).toHaveLength(34);
    expect(allowedTransitions.length + rejectedTransitions.length).toBe(
      JOB_STATUSES.length ** 2,
    );
  });

  it.each(allowedTransitions)("allows %s -> %s", (from, to) => {
    expect(canTransitionJob(from, to)).toBe(true);
    expect(() => assertJobTransition(from, to)).not.toThrow();
  });

  it.each(rejectedTransitions)("rejects %s -> %s", (from, to) => {
    expect(canTransitionJob(from, to)).toBe(false);

    try {
      assertJobTransition(from, to);
      expect.fail("Expected transition to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidJobTransitionError);
      expect(error).toMatchObject({
        name: "InvalidJobTransitionError",
        from,
        to,
        message: `Invalid job transition: ${from} -> ${to}`,
      });
    }
  });
});
