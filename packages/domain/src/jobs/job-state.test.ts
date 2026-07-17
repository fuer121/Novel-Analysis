import { describe, expect, it } from "vitest";
import {
  InvalidJobTransitionError,
  assertJobTransition,
  canTransitionJob,
} from "./job-state.js";

describe("job state transitions", () => {
  it.each([
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
    ["failed", "queued"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(canTransitionJob(from, to)).toBe(true);
    expect(() => assertJobTransition(from, to)).not.toThrow();
  });

  it.each([
    ["queued", "completed"],
    ["paused", "completed"],
    ["completed", "running"],
    ["failed", "completed"],
    ["cancelled", "running"],
  ] as const)("rejects %s -> %s", (from, to) => {
    expect(canTransitionJob(from, to)).toBe(false);
    expect(() => assertJobTransition(from, to)).toThrow(InvalidJobTransitionError);
  });
});
