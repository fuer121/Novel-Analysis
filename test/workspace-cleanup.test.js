import test from "node:test";
import assert from "node:assert/strict";

import { evaluateCleanup } from "../scripts/workspace-cleanup.mjs";

function createAudit(overrides = {}) {
  return {
    root: "/repo",
    worktrees: [{
      path: "/worktrees/task",
      branch: "task",
      clean: true,
      headInMain: true,
    }],
    branches: [{
      name: "task",
      upstream: "origin/task",
      ahead: 0,
      checkedOut: true,
      headInMain: true,
    }],
    ...overrides,
  };
}

test("allows only clean, pushed, merged worktrees whose HEAD is in main", () => {
  const result = evaluateCleanup(createAudit(), new Set(["task"]));

  assert.equal(result.worktrees[0].eligible, true);
  assert.deepEqual(result.worktrees[0].blockers, []);
  assert.equal(result.branches[0].eligible, false);
  assert.deepEqual(result.branches[0].blockers, ["branch belongs to a listed worktree"]);
});

test("blocks worktrees when any required safety evidence is missing", () => {
  const audit = createAudit({
    worktrees: [{ path: "/worktrees/task", branch: "task", clean: false, headInMain: false }],
    branches: [{ name: "task", upstream: null, ahead: 1, checkedOut: true, headInMain: false }],
  });
  const result = evaluateCleanup(audit);

  assert.equal(result.worktrees[0].eligible, false);
  assert.deepEqual(result.worktrees[0].blockers, [
    "worktree is dirty",
    "HEAD is not in main",
    "branch has no upstream",
    "branch is 1 commit(s) ahead of upstream",
    "merged PR is not verified",
  ]);
});

test("allows an unclaimed local branch only with complete evidence", () => {
  const audit = createAudit({ worktrees: [], branches: createAudit().branches });
  const result = evaluateCleanup(audit, new Set(["task"]));

  assert.equal(result.branches[0].eligible, true);
});
