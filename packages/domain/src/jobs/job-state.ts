import type { JobStatus } from "@novel-analysis/contracts";

const transitions: Readonly<Record<JobStatus, ReadonlySet<JobStatus>>> = {
  queued: new Set(["running", "paused", "cancelled"]),
  running: new Set(["retrying", "paused", "completed", "failed", "cancelled"]),
  retrying: new Set(["running", "paused", "failed", "cancelled"]),
  paused: new Set(["queued", "running", "cancelled"]),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

export class InvalidJobTransitionError extends Error {
  constructor(
    public readonly from: JobStatus,
    public readonly to: JobStatus,
  ) {
    super(`Invalid job transition: ${from} -> ${to}`);
    this.name = "InvalidJobTransitionError";
  }
}

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return transitions[from].has(to);
}

export function assertJobTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransitionJob(from, to)) {
    throw new InvalidJobTransitionError(from, to);
  }
}
