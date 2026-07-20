import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { validateProjectSource } from "../scripts/check-project-source.mjs";

const projectDocument = `---
project_id: novel-analysis-refactor
source_version: 1
baseline_commit: 0123456789abcdef0123456789abcdef01234567
baseline_status: current
updated_at: 2026-07-17T10:00:00+08:00
updated_by: codex
current_phase: implementation
last_checkpoint: checkpoint-001
next_gate: validator-implementation
---

# Project Source Of Truth

## Current Baseline

[Workflow manifest](../../dify-workflows/manifest.json)

## Phase Status

Implementation

## Active Work

| Task | Phase | Scope | Owner | Branch | Base | Head | Status | Depends On | Checkpoint | Next Action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| task-001 | phase-1 | Define project source validation | controller-agent | none | 0123456789abcdef0123456789abcdef01234567 | none | planned | governance source merged | none | implement validator |

## Effective Decisions

[Decision 001](./decisions/decision-001.md)

## Risks And Blockers

None

## Pending Feedback

None

## Next Gate

Implement the validator

## Evidence Index

[Checkpoint 001](./checkpoints/checkpoint-001.md)

## Update Protocol

Update this document after an accepted checkpoint
`;

const checkpointDocument = `---
checkpoint_id: checkpoint-001
task_id: task-001
status: accepted
recorded_at: 2026-07-17T10:00:00+08:00
base_commit: 0123456789abcdef0123456789abcdef01234567
head_commit: 123456789abcdef0123456789abcdef012345678
supersedes: none
---

# Checkpoint 001

## Scope

Validate the project source

## Evidence

Tests pass

## Accepted Result

The project source is valid
`;

const decisionDocument = `---
decision_id: decision-001
status: accepted
recorded_at: 2026-07-17T10:00:00+08:00
confidence: high
scope: project-governance
supersedes: none
---

# Decision 001

## Decision

Use one project source

## Source

Project governance review
`;

const taskContractTemplate = `# Task Contract Template

## Core Allowed Modules
## Mechanical Adjacent Scope
## Base Commit
## Success Criteria
## Prohibited Changes
## Required Verification
## Escalation Conditions
## Resource Budget
`;

const checkpointTemplate = `# Checkpoint Submission Template

## Assigned Scope
## Prohibited Changes Audit
## Actual Changes
## Verification By Role
## Scope Deviations
## Escalations
## Risks And Blockers
## Recommended Next Action
## Acceptance Request
`;

async function createFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "project-source-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.mkdir(path.join(root, "docs/project/checkpoints"), { recursive: true });
  await fs.mkdir(path.join(root, "docs/project/decisions"), { recursive: true });
  await fs.mkdir(path.join(root, "docs/project/templates"), { recursive: true });
  await fs.mkdir(path.join(root, "dify-workflows"), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(root, "docs/project/PROJECT.md"), projectDocument),
    fs.writeFile(path.join(root, "docs/project/checkpoints/checkpoint-001.md"), checkpointDocument),
    fs.writeFile(path.join(root, "docs/project/decisions/decision-001.md"), decisionDocument),
    fs.writeFile(path.join(root, "docs/project/templates/task-contract.md"), taskContractTemplate),
    fs.writeFile(path.join(root, "docs/project/templates/checkpoint.md"), checkpointTemplate),
    fs.writeFile(
      path.join(root, "dify-workflows/manifest.json"),
      `${JSON.stringify({ schemaVersion: 1, workflows: {} }, null, 2)}\n`,
    ),
  ]);

  return root;
}

async function writeCheckpoint(root, name, content) {
  await fs.writeFile(path.join(root, "docs/project/checkpoints", name), content);
}

async function writeDecision(root, name, content) {
  await fs.writeFile(path.join(root, "docs/project/decisions", name), content);
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

async function createGitFixture(t) {
  const root = await createFixture(t);
  git(root, ["init"]);
  git(root, ["config", "user.name", "Project Source Test"]);
  git(root, ["config", "user.email", "project-source@example.com"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "initial fixture"]);
  const initialCommit = git(root, ["rev-parse", "HEAD"]);
  await replaceInProject(
    root,
    "0123456789abcdef0123456789abcdef01234567",
    initialCommit,
  );
  git(root, ["add", "docs/project/PROJECT.md"]);
  git(root, ["commit", "-m", "set fixture baseline"]);
  return { root, baseRef: git(root, ["rev-parse", "HEAD"]) };
}

async function replaceInProject(root, search, replacement) {
  const projectPath = path.join(root, "docs/project/PROJECT.md");
  const content = await fs.readFile(projectPath, "utf8");
  await fs.writeFile(projectPath, content.replace(search, replacement));
}

test("accepts a complete project source fixture", async (t) => {
  const root = await createFixture(t);

  assert.deepEqual(await validateProjectSource(root, { checkGit: false }), []);
});

test("rejects missing governance templates and required sections", async (t) => {
  const root = await createFixture(t);
  await fs.rm(path.join(root, "docs/project/templates/task-contract.md"));
  await fs.writeFile(
    path.join(root, "docs/project/templates/checkpoint.md"),
    checkpointTemplate.replace("## Verification By Role\n", ""),
  );

  const errors = await validateProjectSource(root, { checkGit: false });
  assert.match(errors.join("\n"), /Could not read governance template task-contract\.md/);
  assert.match(errors.join("\n"), /checkpoint\.md.*Verification By Role/);
});

test("accepts a percent-encoded local reference", async (t) => {
  const root = await createFixture(t);
  await fs.writeFile(
    path.join(root, "docs/project/decisions/decision 001.md"),
    decisionDocument.replaceAll("decision-001", "decision-space"),
  );
  await replaceInProject(
    root,
    "./decisions/decision-001.md",
    "./decisions/decision%20001.md",
  );

  assert.deepEqual(await validateProjectSource(root, { checkGit: false }), []);
});

test("rejects project references outside the repository", async (t) => {
  const targets = [
    ["absolute path", () => "/etc/passwd"],
    [
      "relative traversal",
      (root, outsidePath) => path.relative(path.join(root, "docs/project"), outsidePath),
    ],
    [
      "encoded traversal",
      (root, outsidePath) => path
        .relative(path.join(root, "docs/project"), outsidePath)
        .replaceAll("..", "%2e%2e"),
    ],
  ];

  for (const [name, getTarget] of targets) {
    await t.test(name, async (subtest) => {
      const root = await createFixture(subtest);
      const outsidePath = `${root}-outside.md`;
      subtest.after(() => fs.rm(outsidePath, { force: true }));
      await fs.writeFile(outsidePath, "# Outside\n");
      await replaceInProject(root, "./decisions/decision-001.md", getTarget(root, outsidePath));

      const errors = await validateProjectSource(root, { checkGit: false });
      assert.match(errors.join("\n"), /outside repository/);
    });
  }
});

test("rejects a project reference through a symlink outside the repository", async (t) => {
  const root = await createFixture(t);
  const outsideDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "project-source-outside-"));
  t.after(() => fs.rm(outsideDirectory, { recursive: true, force: true }));
  const outsidePath = path.join(outsideDirectory, "decision.md");
  const linkPath = path.join(root, "docs/project/decisions/outside-link.md");
  await fs.writeFile(outsidePath, "# Outside\n");

  try {
    await fs.symlink(outsidePath, linkPath);
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES") {
      t.skip(`symlinks are not supported: ${error.code}`);
      return;
    }
    throw error;
  }

  await replaceInProject(root, "./decisions/decision-001.md", "./decisions/outside-link.md");
  const errors = await validateProjectSource(root, { checkGit: false });
  assert.match(errors.join("\n"), /outside repository/);
});

test("accepts blank lines between front matter fields", async (t) => {
  const root = await createFixture(t);
  await replaceInProject(root, "source_version: 1\n", "source_version: 1\n\n");

  assert.deepEqual(await validateProjectSource(root, { checkGit: false }), []);
});

test("rejects missing updated_by, invalid baseline_commit, and invalid baseline_status", async (t) => {
  const cases = [
    ["updated_by", "updated_by: codex\n", ""],
    ["baseline_commit", "baseline_commit: 0123456789abcdef0123456789abcdef01234567", "baseline_commit: not-a-commit"],
    ["baseline_status", "baseline_status: current", "baseline_status: unknown"],
  ];

  for (const [field, search, replacement] of cases) {
    const root = await createFixture(t);
    await replaceInProject(root, search, replacement);

    const errors = await validateProjectSource(root, { checkGit: false });
    assert.match(errors.join("\n"), new RegExp(field));
  }
});

test("rejects a broken local reference in PROJECT.md", async (t) => {
  const root = await createFixture(t);
  await replaceInProject(root, "./decisions/decision-001.md", "./decisions/missing.md");

  const errors = await validateProjectSource(root, { checkGit: false });
  assert.match(errors.join("\n"), /missing\.md|local reference/);
});

test("rejects duplicate checkpoint_id values", async (t) => {
  const root = await createFixture(t);
  await fs.writeFile(
    path.join(root, "docs/project/checkpoints/checkpoint-duplicate.md"),
    checkpointDocument.replace("task_id: task-001", "task_id: task-002"),
  );

  const errors = await validateProjectSource(root, { checkGit: false });
  assert.match(errors.join("\n"), /duplicate.*checkpoint-001|checkpoint-001.*duplicate/i);
});

test("rejects last_checkpoint when it points to a rejected checkpoint", async (t) => {
  const root = await createFixture(t);
  const checkpointPath = path.join(root, "docs/project/checkpoints/checkpoint-001.md");
  await fs.writeFile(checkpointPath, checkpointDocument.replace("status: accepted", "status: rejected"));

  const errors = await validateProjectSource(root, { checkGit: false });
  assert.match(errors.join("\n"), /last_checkpoint.*accepted|checkpoint-001.*rejected/i);
});

test("rejects an invalid checkpoint status", async (t) => {
  const root = await createFixture(t);
  const checkpointPath = path.join(root, "docs/project/checkpoints/checkpoint-001.md");
  await fs.writeFile(checkpointPath, checkpointDocument.replace("status: accepted", "status: pending"));

  const errors = await validateProjectSource(root, { checkGit: false });
  assert.match(errors.join("\n"), /checkpoint.*status|status.*pending/i);
});

test("rejects an Active Work table with a missing required column", async (t) => {
  const root = await createFixture(t);
  await replaceInProject(root, "| Head | Status |", "| Status |");

  const errors = await validateProjectSource(root, { checkGit: false });
  assert.match(errors.join("\n"), /Active Work.*columns|missing.*Head/i);
});

test("rejects invalid Active Work status and commit values", async (t) => {
  const cases = [
    ["status", "| planned |", "| pending |"],
    ["base", "0123456789abcdef0123456789abcdef01234567 | none | planned", "not-a-sha | none | planned"],
    ["head", "0123456789abcdef0123456789abcdef01234567 | none | planned", "0123456789abcdef0123456789abcdef01234567 | ABC123 | planned"],
  ];

  for (const [field, search, replacement] of cases) {
    await t.test(field, async (subtest) => {
      const root = await createFixture(subtest);
      await replaceInProject(root, search, replacement);
      const errors = await validateProjectSource(root, { checkGit: false });
      assert.match(errors.join("\n"), new RegExp(`Active Work.*${field}`, "i"));
    });
  }
});

test("rejects an accepted checkpoint missing metadata and evidence sections", async (t) => {
  const root = await createFixture(t);
  await writeCheckpoint(root, "checkpoint-001.md", `---\ncheckpoint_id: checkpoint-001\nstatus: accepted\n---\n`);

  const errors = await validateProjectSource(root, { checkGit: false });
  assert.match(errors.join("\n"), /task_id/);
  assert.match(errors.join("\n"), /recorded_at/);
  assert.match(errors.join("\n"), /base_commit/);
  assert.match(errors.join("\n"), /head_commit/);
  assert.match(errors.join("\n"), /supersedes/);
  assert.match(errors.join("\n"), /Scope/);
  assert.match(errors.join("\n"), /Evidence/);
  assert.match(errors.join("\n"), /Accepted Result/);
});

test("rejects invalid checkpoint commits and timestamp", async (t) => {
  const root = await createFixture(t);
  await writeCheckpoint(
    root,
    "checkpoint-001.md",
    checkpointDocument
      .replace("recorded_at: 2026-07-17T10:00:00+08:00", "recorded_at: never")
      .replace("base_commit: 0123456789abcdef0123456789abcdef01234567", "base_commit: invalid")
      .replace("head_commit: 123456789abcdef0123456789abcdef012345678", "head_commit: INVALID"),
  );

  const errors = await validateProjectSource(root, { checkGit: false });
  assert.match(errors.join("\n"), /recorded_at/);
  assert.match(errors.join("\n"), /base_commit/);
  assert.match(errors.join("\n"), /head_commit/);
});

test("rejects invalid decision metadata", async (t) => {
  const root = await createFixture(t);
  await writeDecision(
    root,
    "decision-001.md",
    decisionDocument
      .replace("status: accepted", "status: pending")
      .replace("recorded_at: 2026-07-17T10:00:00+08:00", "recorded_at: never")
      .replace("confidence: high\n", "")
      .replace("scope: project-governance\n", ""),
  );

  const errors = await validateProjectSource(root, { checkGit: false });
  assert.match(errors.join("\n"), /decision.*status/i);
  assert.match(errors.join("\n"), /recorded_at/);
  assert.match(errors.join("\n"), /confidence/);
  assert.match(errors.join("\n"), /scope/);
});

test("rejects an accepted decision without evidence sections", async (t) => {
  const root = await createFixture(t);
  await writeDecision(
    root,
    "decision-001.md",
    decisionDocument.slice(0, decisionDocument.indexOf("# Decision 001")),
  );

  const errors = await validateProjectSource(root, { checkGit: false });
  assert.match(errors.join("\n"), /accepted decision.*Decision/i);
  assert.match(errors.join("\n"), /accepted decision.*Source/i);
});

test("requires checkpoint superseders to be accepted", async (t) => {
  for (const status of ["rejected", "submitted"]) {
    await t.test(status, async (subtest) => {
      const root = await createFixture(subtest);
      await writeCheckpoint(
        root,
        "checkpoint-001.md",
        checkpointDocument.replace("status: accepted", "status: superseded"),
      );
      await writeCheckpoint(
        root,
        "checkpoint-002.md",
        checkpointDocument
          .replaceAll("checkpoint-001", "checkpoint-002")
          .replace("status: accepted", `status: ${status}`)
          .replace("supersedes: none", "supersedes: checkpoint-001"),
      );

      const errors = await validateProjectSource(root, { checkGit: false });
      assert.match(errors.join("\n"), /checkpoint-002.*superseder must be accepted/i);
      assert.match(errors.join("\n"), /checkpoint-001.*not targeted/i);
    });
  }
});

test("requires decision superseders to be accepted", async (t) => {
  const root = await createFixture(t);
  await writeDecision(
    root,
    "decision-001.md",
    decisionDocument.replace("status: accepted", "status: superseded"),
  );
  await writeDecision(
    root,
    "decision-002.md",
    decisionDocument
      .replaceAll("decision-001", "decision-002")
      .replace("status: accepted", "status: rejected")
      .replace("supersedes: none", "supersedes: decision-001"),
  );

  const errors = await validateProjectSource(root, { checkGit: false });
  assert.match(errors.join("\n"), /decision-002.*superseder must be accepted/i);
  assert.match(errors.join("\n"), /decision-001.*not targeted/i);
});

test("rejects missing, self-referential, and cyclic checkpoint supersedes links", async (t) => {
  const cases = [
    ["missing", "missing-checkpoint", null],
    ["self", "checkpoint-001", null],
    ["cycle", "checkpoint-002", checkpointDocument.replaceAll("checkpoint-001", "checkpoint-002")],
  ];

  for (const [name, supersedes, secondDocument] of cases) {
    await t.test(name, async (subtest) => {
      const root = await createFixture(subtest);
      await writeCheckpoint(
        root,
        "checkpoint-001.md",
        checkpointDocument.replace("supersedes: none", `supersedes: ${supersedes}`),
      );
      if (secondDocument) {
        await writeCheckpoint(
          root,
          "checkpoint-002.md",
          secondDocument.replace("supersedes: none", "supersedes: checkpoint-001"),
        );
      }
      const errors = await validateProjectSource(root, { checkGit: false });
      assert.match(errors.join("\n"), /supersedes.*(?:missing|self|cycle)|(?:missing|self|cycle).*supersedes/i);
    });
  }
});

test("rejects missing, self-referential, and cyclic decision supersedes links", async (t) => {
  const cases = [
    ["missing", "missing-decision", null],
    ["self", "decision-001", null],
    ["cycle", "decision-002", decisionDocument.replaceAll("decision-001", "decision-002")],
  ];

  for (const [name, supersedes, secondDocument] of cases) {
    await t.test(name, async (subtest) => {
      const root = await createFixture(subtest);
      await writeDecision(
        root,
        "decision-001.md",
        decisionDocument.replace("supersedes: none", `supersedes: ${supersedes}`),
      );
      if (secondDocument) {
        await writeDecision(
          root,
          "decision-002.md",
          secondDocument.replace("supersedes: none", "supersedes: decision-001"),
        );
      }
      const errors = await validateProjectSource(root, { checkGit: false });
      assert.match(errors.join("\n"), /supersedes.*(?:missing|self|cycle)|(?:missing|self|cycle).*supersedes/i);
    });
  }
});

test("requires a superseded record to be targeted by another record", async (t) => {
  const root = await createFixture(t);
  await writeDecision(
    root,
    "decision-001.md",
    decisionDocument.replace("status: accepted", "status: superseded"),
  );

  const errors = await validateProjectSource(root, { checkGit: false });
  assert.match(errors.join("\n"), /superseded.*targeted|replacement.*supersedes/i);
});

test("rejects modification or deletion of accepted governance records from baseRef", async (t) => {
  const cases = [
    ["modified checkpoint", "docs/project/checkpoints/checkpoint-001.md", "\nchanged\n"],
    ["deleted checkpoint", "docs/project/checkpoints/checkpoint-001.md", null],
    ["modified decision", "docs/project/decisions/decision-001.md", "\nchanged\n"],
  ];

  for (const [name, relativePath, suffix] of cases) {
    await t.test(name, async (subtest) => {
      const { root, baseRef } = await createGitFixture(subtest);
      const target = path.join(root, relativePath);
      if (suffix === null) {
        await fs.rm(target);
      } else {
        await fs.appendFile(target, suffix);
      }
      const errors = await validateProjectSource(root, { baseRef });
      assert.match(errors.join("\n"), /accepted governance record is immutable/);
    });
  }
});

test("rejects an invalid baseRef but treats an all-zero initial-push ref as unavailable", async (t) => {
  const { root } = await createGitFixture(t);

  const invalidErrors = await validateProjectSource(root, { baseRef: "not-a-commit" });
  assert.match(invalidErrors.join("\n"), /baseRef|base ref/i);

  const missingErrors = await validateProjectSource(root, { baseRef: "f".repeat(40) });
  assert.match(missingErrors.join("\n"), /baseRef.*does not exist|base ref.*does not exist/i);

  assert.deepEqual(
    await validateProjectSource(root, { baseRef: "0".repeat(40) }),
    [],
  );
});
