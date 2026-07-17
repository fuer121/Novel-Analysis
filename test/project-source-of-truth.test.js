import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

Define project source validation

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
supersedes: null
---

# Checkpoint 001
`;

async function createFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "project-source-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.mkdir(path.join(root, "docs/project/checkpoints"), { recursive: true });
  await fs.mkdir(path.join(root, "docs/project/decisions"), { recursive: true });
  await fs.mkdir(path.join(root, "dify-workflows"), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(root, "docs/project/PROJECT.md"), projectDocument),
    fs.writeFile(path.join(root, "docs/project/checkpoints/checkpoint-001.md"), checkpointDocument),
    fs.writeFile(path.join(root, "docs/project/decisions/decision-001.md"), "# Decision 001\n"),
    fs.writeFile(
      path.join(root, "dify-workflows/manifest.json"),
      `${JSON.stringify({ schemaVersion: 1, workflows: {} }, null, 2)}\n`,
    ),
  ]);

  return root;
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
