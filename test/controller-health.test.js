import test from "node:test";
import assert from "node:assert/strict";

import {
  formatControllerHealth,
  summarizeControllerHealth,
} from "../scripts/controller-health.mjs";

test("summarizes workspace and project source observations", () => {
  const audit = {
    worktrees: [
      { branch: "main", clean: true, nodeModulesKb: 256 },
      { branch: "feature", clean: true, nodeModulesKb: 0 },
    ],
    branches: [{ name: "main" }, { name: "feature" }],
    localWorktreeDirectoryKb: 0,
  };
  const projectContent = [
    "# Project",
    "",
    "## Active Work",
    "",
    "| Task | Status |",
    "| --- | --- |",
    "| TASK-1 | active |",
    "",
    "## Risks And Blockers",
    "",
    ...Array.from({ length: 110 }, (_, index) => `line ${index + 1}`),
  ].join("\n");

  assert.deepEqual(summarizeControllerHealth(audit, projectContent), {
    workspace: {
      mainClean: true,
      additionalWorktrees: 1,
      dirtyWorktrees: 0,
      localBranches: 2,
      nodeModulesCopies: 1,
      nodeModulesKb: 256,
      repositoryWorktreeKb: 0,
    },
    projectSource: {
      lines: 120,
      activeWorkRows: 1,
    },
  });
  assert.equal(summarizeControllerHealth(audit, `${projectContent}\n`).projectSource.lines, 120);
});

test("reports a missing main worktree and formats stable text", () => {
  const summary = summarizeControllerHealth({
    worktrees: [
      { branch: "feature", clean: false, nodeModulesKb: 12 },
      { branch: null, clean: true, nodeModulesKb: 8 },
    ],
    branches: [{ name: "main" }, { name: "feature" }, { name: "review" }],
    localWorktreeDirectoryKb: 64,
  }, [
    "# Project",
    "## Active Work",
    "| Task | Status |",
    "| --- | --- |",
    "| TASK-1 | ready |",
    "| TASK-2 | blocked |",
    "## Phase Ledgers",
  ].join("\n"));

  assert.equal(summary.workspace.mainClean, false);
  assert.equal(formatControllerHealth(summary), [
    "Controller Health",
    "Main clean: false",
    "Additional worktrees: 2",
    "Dirty worktrees: 1",
    "Local branches: 3",
    "Node modules copies: 2",
    "Node modules: 20 KB",
    "Repository .worktrees: 64 KB",
    "Project source lines: 7",
    "Active work rows: 2",
  ].join("\n"));
});

test("counts only the first table in Active Work", () => {
  const audit = {
    worktrees: [{ branch: "main", clean: true, nodeModulesKb: 0 }],
    branches: [{ name: "main" }],
    localWorktreeDirectoryKb: 0,
  };
  const projectContent = [
    "## Active Work",
    "",
    "| Task | Status |",
    "| --- | --- |",
    "| TASK-1 | ready |",
    "",
    "Supplementary data",
    "",
    "| Item | Value |",
    "| --- | --- |",
    "| One | 1 |",
    "| Two | 2 |",
    "| Three | 3 |",
    "",
    "## Phase Ledgers",
  ].join("\n");

  assert.equal(summarizeControllerHealth(audit, projectContent).projectSource.activeWorkRows, 1);
});
