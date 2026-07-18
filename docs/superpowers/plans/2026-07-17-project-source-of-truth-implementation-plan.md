# Project Source Of Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立仓库内唯一项目级信源、总控单写权限、结构化 checkpoint 反馈机制和可在 CI 中执行的确定性校验

**Architecture:** `docs/project/PROJECT.md` 保存当前有效基线，checkpoint 与 decision 保存可追溯证据，根 `AGENTS.md` 固化总控与执行 Agent 的协作边界。一个无新增依赖的 Node.js 校验器验证 front matter、状态、引用、checkpoint 唯一性和 Git 基线关系，并由现有 `npm run verify` 和 GitHub Actions 执行

**Tech Stack:** Markdown、Node.js 26 ESM、`node:test`、Git、npm scripts、GitHub Actions

---

## File Structure

| File | Responsibility |
| --- | --- |
| `AGENTS.md` | 规定所有 Agent 的读取顺序、写入权限、反馈契约和暂停条件 |
| `docs/project/PROJECT.md` | 唯一当前决策入口，保存实现基线、阶段、任务、决策、风险和下一 gate |
| `docs/project/checkpoints/CP-20260717-PHASE0-MERGED.md` | Phase 0 已合并且 CI 通过的 accepted 证据 |
| `docs/project/decisions/DEC-0001-project-governance.md` | 总控单写、证据优先级和冲突暂停规则 |
| `docs/project/templates/checkpoint.md` | 执行 Agent 的统一反馈格式 |
| `scripts/check-project-source.mjs` | 校验唯一信源结构、引用、checkpoint 和 Git 基线 |
| `test/project-source-of-truth.test.js` | 用临时目录验证有效和无效项目治理数据 |
| `README.md` | 将用户和新 Agent 指向新的唯一信源 |
| `docs/PROJECT_CONTROL_BASELINE.md` | 增加历史基线告示，保留旧系统实现参考 |
| `package.json` | 暴露 `project:check` 并纳入 `verify` |
| `.github/workflows/ci.yml` | 给项目基线校验提供独立、可见的 CI step |

## Task 1: Project Source Validator Contract

**Files:**
- Create: `test/project-source-of-truth.test.js`
- Create: `scripts/check-project-source.mjs`

- [ ] **Step 1: Write the failing validator tests**

Create `test/project-source-of-truth.test.js` with this content

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { validateProjectSource } from "../scripts/check-project-source.mjs";

const validCommit = "be49f4ccd312a269ee4c7419c6d9d08407df2c21";

async function writeFixture({
  projectOverrides = {},
  checkpointOverrides = {},
  duplicateCheckpoint = false,
  includeDecision = true,
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "project-source-"));
  const projectDir = path.join(root, "docs/project");
  const checkpointDir = path.join(projectDir, "checkpoints");
  const decisionDir = path.join(projectDir, "decisions");
  await fs.mkdir(checkpointDir, { recursive: true });
  await fs.mkdir(decisionDir, { recursive: true });
  await fs.mkdir(path.join(root, "dify-workflows"), { recursive: true });
  await fs.writeFile(path.join(root, "dify-workflows/manifest.json"), "{}\n");

  const project = {
    project_id: "novel-analysis-refactor",
    source_version: "1",
    baseline_commit: validCommit,
    baseline_status: "current",
    updated_at: "2026-07-17T17:00:00+08:00",
    updated_by: "controller-agent",
    current_phase: "phase-1-planning",
    last_checkpoint: "CP-20260717-PHASE0-MERGED",
    next_gate: "GATE-PHASE1-PLAN-APPROVED",
    ...projectOverrides,
  };
  const frontMatter = Object.entries(project).map(([key, value]) => `${key}: ${value}`).join("\n");
  const body = `---\n${frontMatter}\n---\n\n# Project\n\n## Current Baseline\n\n[Manifest](../../dify-workflows/manifest.json)\n\n## Phase Status\n\nPhase 1 planning\n\n## Active Work\n\nNone\n\n## Effective Decisions\n\n[Governance](decisions/DEC-0001-project-governance.md)\n\n## Risks And Blockers\n\nNone\n\n## Pending Feedback\n\nNone\n\n## Next Gate\n\nPlan approval\n\n## Evidence Index\n\n[Checkpoint](checkpoints/CP-20260717-PHASE0-MERGED.md)\n\n## Update Protocol\n\nController only\n`;
  await fs.writeFile(path.join(projectDir, "PROJECT.md"), body);

  const checkpoint = {
    checkpoint_id: "CP-20260717-PHASE0-MERGED",
    task_id: "PHASE0-COMPLETION",
    status: "accepted",
    recorded_at: "2026-07-17T17:00:00+08:00",
    base_commit: validCommit,
    head_commit: validCommit,
    supersedes: "none",
    ...checkpointOverrides,
  };
  const checkpointText = `---\n${Object.entries(checkpoint).map(([key, value]) => `${key}: ${value}`).join("\n")}\n---\n\n# Phase 0\n`;
  await fs.writeFile(path.join(checkpointDir, "CP-20260717-PHASE0-MERGED.md"), checkpointText);
  if (duplicateCheckpoint) {
    await fs.writeFile(path.join(checkpointDir, "duplicate.md"), checkpointText);
  }
  if (includeDecision) {
    await fs.writeFile(path.join(decisionDir, "DEC-0001-project-governance.md"), "# Governance\n");
  }
  return root;
}

test("accepts a complete project source fixture", async (t) => {
  const root = await writeFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.deepEqual(await validateProjectSource(root, { checkGit: false }), []);
});

test("rejects missing fields and invalid project states", async (t) => {
  const root = await writeFixture({ projectOverrides: { baseline_commit: "bad", baseline_status: "unknown", updated_by: "" } });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const errors = await validateProjectSource(root, { checkGit: false });
  assert.ok(errors.some((error) => error.includes("baseline_commit")));
  assert.ok(errors.some((error) => error.includes("baseline_status")));
  assert.ok(errors.some((error) => error.includes("updated_by")));
});

test("rejects broken project references", async (t) => {
  const root = await writeFixture({ includeDecision: false });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const errors = await validateProjectSource(root, { checkGit: false });
  assert.ok(errors.some((error) => error.includes("DEC-0001-project-governance.md")));
});

test("rejects duplicate checkpoint ids", async (t) => {
  const root = await writeFixture({ duplicateCheckpoint: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const errors = await validateProjectSource(root, { checkGit: false });
  assert.ok(errors.some((error) => error.includes("duplicate checkpoint_id")));
});

test("requires last_checkpoint to reference an accepted checkpoint", async (t) => {
  const root = await writeFixture({ checkpointOverrides: { status: "rejected" } });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const errors = await validateProjectSource(root, { checkGit: false });
  assert.ok(errors.some((error) => error.includes("last_checkpoint must be accepted")));
});

test("rejects invalid checkpoint states", async (t) => {
  const root = await writeFixture({ checkpointOverrides: { status: "unknown" } });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const errors = await validateProjectSource(root, { checkGit: false });
  assert.ok(errors.some((error) => error.includes("invalid checkpoint status")));
});
```

- [ ] **Step 2: Add the empty module so the test fails on behavior instead of import**

Create `scripts/check-project-source.mjs`

```js
export async function validateProjectSource() {
  return ["project source validation is not implemented"];
}
```

- [ ] **Step 3: Run the focused test and confirm RED**

Run

```bash
node --test test/project-source-of-truth.test.js
```

Expected: 6 tests fail because the validator returns only `project source validation is not implemented`

- [ ] **Step 4: Commit the failing contract**

```bash
git add test/project-source-of-truth.test.js scripts/check-project-source.mjs
git commit -m "test: define project source validation"
```

## Task 2: Minimal Project Source Validator

**Files:**
- Modify: `scripts/check-project-source.mjs`
- Test: `test/project-source-of-truth.test.js`

- [ ] **Step 1: Replace the stub with the minimal validator**

Replace `scripts/check-project-source.mjs` with

```js
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_FIELDS = [
  "project_id",
  "source_version",
  "baseline_commit",
  "baseline_status",
  "updated_at",
  "updated_by",
  "current_phase",
  "last_checkpoint",
  "next_gate",
];
const PROJECT_STATUSES = new Set(["current", "stale", "conflicted", "blocked"]);
const CHECKPOINT_STATUSES = new Set(["submitted", "validating", "accepted", "rejected", "superseded"]);
const REQUIRED_SECTIONS = [
  "Current Baseline",
  "Phase Status",
  "Active Work",
  "Effective Decisions",
  "Risks And Blockers",
  "Pending Feedback",
  "Next Gate",
  "Evidence Index",
  "Update Protocol",
];

function parseFrontMatter(content, file) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error(`${file}: missing YAML front matter`);
  return Object.fromEntries(match[1].split("\n").filter(Boolean).map((line) => {
    const colon = line.indexOf(":");
    if (colon < 1) throw new Error(`${file}: invalid front matter line ${line}`);
    return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
  }));
}

async function markdownFiles(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => path.join(directory, entry.name));
}

function localReferences(content) {
  return [...content.matchAll(/\[[^\]]+\]\((?!https?:\/\/|mailto:|#)([^)#]+)(?:#[^)]+)?\)/g)].map((match) => match[1]);
}

export async function validateProjectSource(root, { checkGit = true } = {}) {
  const errors = [];
  const projectFile = path.join(root, "docs/project/PROJECT.md");
  let content;
  let project;
  try {
    content = await fs.readFile(projectFile, "utf8");
    project = parseFrontMatter(content, projectFile);
  } catch (error) {
    return [error.message];
  }

  for (const field of PROJECT_FIELDS) {
    if (!project[field]) errors.push(`PROJECT.md: missing ${field}`);
  }
  if (!/^[0-9a-f]{40}$/.test(project.baseline_commit || "")) {
    errors.push("PROJECT.md: baseline_commit must be a 40-character lowercase Git SHA");
  }
  if (!PROJECT_STATUSES.has(project.baseline_status)) {
    errors.push(`PROJECT.md: invalid baseline_status ${project.baseline_status}`);
  }
  for (const section of REQUIRED_SECTIONS) {
    if (!content.includes(`## ${section}`)) errors.push(`PROJECT.md: missing section ${section}`);
  }
  for (const reference of localReferences(content)) {
    const target = path.resolve(path.dirname(projectFile), decodeURIComponent(reference));
    try {
      await fs.access(target);
    } catch {
      errors.push(`PROJECT.md: missing reference ${reference}`);
    }
  }

  const checkpoints = new Map();
  for (const file of await markdownFiles(path.join(root, "docs/project/checkpoints"))) {
    try {
      const checkpoint = parseFrontMatter(await fs.readFile(file, "utf8"), file);
      if (!checkpoint.checkpoint_id) {
        errors.push(`${file}: missing checkpoint_id`);
        continue;
      }
      if (checkpoints.has(checkpoint.checkpoint_id)) {
        errors.push(`duplicate checkpoint_id ${checkpoint.checkpoint_id}`);
      }
      checkpoints.set(checkpoint.checkpoint_id, checkpoint);
      if (!CHECKPOINT_STATUSES.has(checkpoint.status)) {
        errors.push(`${file}: invalid checkpoint status ${checkpoint.status}`);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }
  const lastCheckpoint = checkpoints.get(project.last_checkpoint);
  if (!lastCheckpoint) {
    errors.push(`PROJECT.md: last_checkpoint ${project.last_checkpoint} does not exist`);
  } else if (lastCheckpoint.status !== "accepted") {
    errors.push("PROJECT.md: last_checkpoint must be accepted");
  }

  if (checkGit && /^[0-9a-f]{40}$/.test(project.baseline_commit || "")) {
    try {
      execFileSync("git", ["cat-file", "-e", `${project.baseline_commit}^{commit}`], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["merge-base", "--is-ancestor", project.baseline_commit, "HEAD"], { cwd: root, stdio: "ignore" });
    } catch {
      errors.push(`PROJECT.md: baseline_commit ${project.baseline_commit} is not an ancestor of HEAD`);
    }
  }
  return errors;
}

async function main() {
  const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
  const errors = await validateProjectSource(root);
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log("Project source of truth is valid");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
```

- [ ] **Step 2: Run the focused test and confirm GREEN**

Run

```bash
node --test test/project-source-of-truth.test.js
```

Expected: 6 tests pass, 0 fail

- [ ] **Step 3: Run lint on the new JavaScript files**

Run

```bash
npx eslint scripts/check-project-source.mjs test/project-source-of-truth.test.js
```

Expected: exit 0 with no output

- [ ] **Step 4: Commit the validator**

```bash
git add scripts/check-project-source.mjs
git commit -m "feat: validate project source of truth"
```

## Task 3: Canonical Project Source And Evidence

**Files:**
- Create: `docs/project/PROJECT.md`
- Create: `docs/project/checkpoints/CP-20260717-PHASE0-MERGED.md`
- Create: `docs/project/decisions/DEC-0001-project-governance.md`
- Create: `docs/project/templates/checkpoint.md`

- [ ] **Step 1: Create the canonical source**

Create `docs/project/PROJECT.md`

```markdown
---
project_id: novel-analysis-refactor
source_version: 1
baseline_commit: be49f4ccd312a269ee4c7419c6d9d08407df2c21
baseline_status: current
updated_at: 2026-07-17T17:00:00+08:00
updated_by: controller-agent
current_phase: phase-1-planning
last_checkpoint: CP-20260717-PHASE0-MERGED
next_gate: GATE-PHASE1-PLAN-APPROVED
---

# Novel Analysis Refactor Project Source

本文件是项目当前状态与后续决策的唯一入口。线程上下文不能替代本文件

## Current Baseline

- Repository: `fuer121/Novel-Analysis`
- Default branch: `main`
- Accepted implementation baseline: `be49f4ccd312a269ee4c7419c6d9d08407df2c21`
- Phase 0 PR: [#1](https://github.com/fuer121/Novel-Analysis/pull/1)
- Phase 0 CI: passed
- Current legacy app: compatibility baseline only, not the refactored frontend
- Workflow baseline: [five confirmed online exports](../../dify-workflows/manifest.json)

## Phase Status

| Phase | Status | Evidence |
| --- | --- | --- |
| Phase 0 foundation contracts | merged | [Checkpoint](checkpoints/CP-20260717-PHASE0-MERGED.md) |
| Phase 1 collaboration and job kernel | planning | [Roadmap](../superpowers/plans/2026-07-16-novel-analysis-refactor-roadmap.md) |
| Phase 2 library, L1 and L2 | blocked by Phase 1 | [Roadmap](../superpowers/plans/2026-07-16-novel-analysis-refactor-roadmap.md) |
| Phase 3 L2 continuous questions | blocked by Phase 2 | [Roadmap](../superpowers/plans/2026-07-16-novel-analysis-refactor-roadmap.md) |

## Active Work

| Task | Scope | Status | Depends On | Next Action |
| --- | --- | --- | --- | --- |
| PHASE1-PLAN | Phase 1 detailed implementation plan | planned | governance source merged | write and review plan |

## Effective Decisions

- [DEC-0001 Project governance](decisions/DEC-0001-project-governance.md)
- [Approved refactor design](../superpowers/specs/2026-07-16-novel-analysis-refactor-design.md)
- Development model: complete refactor in the new repository, validate data, then cut over without long-term dual maintenance
- Team and identity: 5-20 LAN users with Feishu login, shared library, admin and member roles
- Architecture: React and TypeScript, modular monolith, PostgreSQL, pg-boss, Dify as workflow executor
- Product core: library establishment, L1, L2, then L2 continuous question analysis

## Risks And Blockers

- npm audit reports 1 low, 1 moderate, 1 high and 2 critical findings that require separate maintenance authorization
- GitHub Actions are not pinned to full commit SHAs
- `JobProgress` currently permits counters above total
- Rejected state transition coverage and diagnostic assertions need Phase 1 hardening
- Dify and OpenAI are not configured in the current local runtime

## Pending Feedback

No submitted feedback is waiting for controller validation

## Next Gate

`GATE-PHASE1-PLAN-APPROVED`

The Phase 1 detailed implementation plan must be written from accepted Phase 0 contracts and reviewed before Phase 1 implementation starts

## Evidence Index

- [Project governance design](../superpowers/specs/2026-07-17-project-source-of-truth-design.md)
- [Refactor roadmap](../superpowers/plans/2026-07-16-novel-analysis-refactor-roadmap.md)
- [Phase 0 handoff](../superpowers/handoffs/2026-07-17-phase-0-foundation-handoff.md)
- [Phase 0 accepted checkpoint](checkpoints/CP-20260717-PHASE0-MERGED.md)
- [Legacy implementation baseline](../PROJECT_CONTROL_BASELINE.md)

## Update Protocol

1. Execution agents submit checkpoint-shaped feedback but do not edit this file
2. The controller validates Git, tests, scope, CI, data and user feedback
3. Only accepted checkpoints may change current state or unlock dependent work
4. Conflicts set `baseline_status` to `conflicted` or `blocked` and pause affected tasks
5. Governance-only commits do not change `baseline_commit`; accepted implementation changes do
```

- [ ] **Step 2: Create the accepted Phase 0 checkpoint**

Create `docs/project/checkpoints/CP-20260717-PHASE0-MERGED.md`

```markdown
---
checkpoint_id: CP-20260717-PHASE0-MERGED
task_id: PHASE0-COMPLETION
status: accepted
recorded_at: 2026-07-17T17:00:00+08:00
base_commit: c5730160404a676d43c2a09e53f7b5d128c5d61e
head_commit: be49f4ccd312a269ee4c7419c6d9d08407df2c21
supersedes: none
---

# Phase 0 Merged Checkpoint

## Scope

Foundation contracts, TypeScript workspace, job state rules, Dify manifest, normalization fixtures, lint and CI

## Evidence

- PR: https://github.com/fuer121/Novel-Analysis/pull/1
- CI: passed
- Merge commit: `be49f4ccd312a269ee4c7419c6d9d08407df2c21`
- Legacy tests: 112 passed
- Contract tests: 5 passed
- Vitest: 32 passed
- Manifest tests: 1 passed
- Typecheck, lint, legacy build and `git diff --check`: passed
- Legacy production files and five Workflow YAML files: unchanged from the Phase 0 base

## Accepted Result

Phase 0 is merged and provides stable contracts, job transition semantics and deterministic Workflow hashes for Phase 1 planning

## Deferred Items

- Job progress counter invariant
- Full rejected transition matrix and diagnostic assertions
- GitHub Actions full SHA pinning
- Existing npm audit findings
```

- [ ] **Step 3: Create the governance decision**

Create `docs/project/decisions/DEC-0001-project-governance.md`

```markdown
---
decision_id: DEC-0001
status: accepted
recorded_at: 2026-07-17T17:00:00+08:00
confidence: high
scope: project-governance
supersedes: none
---

# Controller-Owned Project Source

## Decision

`docs/project/PROJECT.md` is the only current project decision entry. The controller Agent is its only writer. Execution and review Agents submit evidence but cannot directly change the current baseline

## Authority

- Product direction: explicit user confirmation, then current project decisions, then accepted specs
- Implementation behavior: code and automated tests, then accepted checkpoints, then explanatory docs
- Delivery status: remote Git, PR and CI, then local branches, then Agent reports
- Dify behavior: confirmed online YAML exports and manifest, then adapter inference, then historical docs

## Conflict Handling

Conflicting evidence blocks affected work until the controller records a correction checkpoint and updates the project source

## Source

User confirmed the controller-only write model, control-page plus evidence-ledger structure, update lifecycle, authority rules and initial delivery scope on 2026-07-17
```

- [ ] **Step 4: Create the execution feedback template**

Create `docs/project/templates/checkpoint.md`

```markdown
---
checkpoint_id: CP-YYYYMMDD-TASK-ID
task_id: TASK-ID
status: submitted
recorded_at: YYYY-MM-DDTHH:MM:SS+08:00
base_commit: 0000000000000000000000000000000000000000
head_commit: 0000000000000000000000000000000000000000
supersedes: none
---

# Task Checkpoint Feedback

## Assigned Scope

- Allowed files:
- Required behavior:
- Prohibited changes:

## Actual Changes

- Files changed:
- Behavior delivered:

## Verification Evidence

| Command | Result |
| --- | --- |
| `git diff --check` | pending |

## Plan Deviations

None reported

## Risks And Blockers

None reported

## User Feedback

No user acceptance evidence attached

## Decisions Required

None

## Recommended Next Action

Controller validates the diff, tests, branch and task scope

## Acceptance Request

Requested status: `accepted`
```

- [ ] **Step 5: Validate the real project source**

Run

```bash
node scripts/check-project-source.mjs
```

Expected: `Project source of truth is valid`

- [ ] **Step 6: Commit the canonical source and evidence**

```bash
git add docs/project
git commit -m "docs: establish project source of truth"
```

## Task 4: Agent Rules And Legacy Entry Points

**Files:**
- Create: `AGENTS.md`
- Modify: `README.md:5-17`
- Modify: `docs/PROJECT_CONTROL_BASELINE.md:1-5`

- [ ] **Step 1: Create the repository Agent contract**

Create `AGENTS.md`

```markdown
# Repository Agent Rules

## Required Reading

Before planning, implementing, reviewing or debugging, read `docs/project/PROJECT.md`

Read linked specs, plans, decisions, checkpoints and handoffs only when the assigned scope requires them. Thread context is not a project source of truth

## Write Authority

Only the controller Agent may update `docs/project/PROJECT.md`

Execution and review Agents must return feedback using `docs/project/templates/checkpoint.md`. They may not mark their own work accepted or unlock dependent tasks

## Task Contract

Every delegated task must include a task ID, allowed scope, base commit, success criteria, prohibited changes and required verification

Do not start a dependent task when `baseline_status` is `stale`, `conflicted` or `blocked`

## Completion Evidence

Completion claims require fresh command output, a clean scope review and the relevant Git or CI evidence

When evidence conflicts, stop affected work and report the conflict to the controller instead of choosing a source silently
```

- [ ] **Step 2: Replace the README project baseline pointer**

Replace the existing `## 项目基线` section through the line before `## 工作区约定` with

````markdown
## 项目基线

当前重构状态、有效决策、任务进度、风险和下一验收闸门统一维护在：

```text
docs/project/PROJECT.md
```

该文件是项目级唯一信源。旧单机系统实现细节保留在 `docs/PROJECT_CONTROL_BASELINE.md`，不能用于判断当前重构阶段
````

- [ ] **Step 3: Add a historical banner to the legacy baseline**

Insert immediately after the title in `docs/PROJECT_CONTROL_BASELINE.md`

```markdown
> 历史实现基线：本文记录重构前单机 SQLite 应用，不代表当前重构项目状态。当前基线、决策和任务进度以 [`docs/project/PROJECT.md`](project/PROJECT.md) 为唯一入口
```

- [ ] **Step 4: Verify entry points and legacy behavior**

Run

```bash
node scripts/check-project-source.mjs
npm run test:legacy
git diff --check
```

Expected: project source valid, 112 legacy tests pass, whitespace check exits 0

- [ ] **Step 5: Commit Agent rules and entry points**

```bash
git add AGENTS.md README.md docs/PROJECT_CONTROL_BASELINE.md
git commit -m "docs: route agents through project source"
```

## Task 5: Package And CI Integration

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `test/contracts/workspace-config.test.js`

- [ ] **Step 1: Extend the workspace contract test first**

Add these assertions to the first test in `test/contracts/workspace-config.test.js`

```js
  assert.equal(packageJson.scripts["project:check"], "node scripts/check-project-source.mjs");
  assert.equal(
    packageJson.scripts.verify,
    "npm run verify:legacy && npm run verify:new && npm run dify:manifest:check && npm run project:check",
  );
```

- [ ] **Step 2: Run the contract test and confirm RED**

Run

```bash
npm run test:contracts
```

Expected: 1 failure because `project:check` is undefined and 4 existing contract tests pass

- [ ] **Step 3: Add the package script and verification gate**

In `package.json`, add

```json
"project:check": "node scripts/check-project-source.mjs"
```

Replace the `verify` script with

```json
"verify": "npm run verify:legacy && npm run verify:new && npm run dify:manifest:check && npm run project:check"
```

Do not change dependency versions or regenerate `package-lock.json`

- [ ] **Step 4: Name the comprehensive CI gate explicitly**

In `.github/workflows/ci.yml`, replace

```yaml
      - run: npm run verify
```

with

```yaml
      - name: Verify legacy, architecture, Workflow and project contracts
        run: npm run verify
```

The project source check remains part of the single comprehensive verification command and is not executed twice

- [ ] **Step 5: Run focused and full verification**

Run

```bash
npm run test:contracts
node --test test/project-source-of-truth.test.js
npm run project:check
npm run verify
npm run lint
git diff --check
```

Expected

- contract tests: 5 passed
- project source tests: 6 passed
- project source check: valid
- legacy tests: 112 passed
- Vitest: 32 passed
- manifest test: 1 passed
- typecheck, build, lint and whitespace checks: exit 0

- [ ] **Step 6: Commit package and CI integration**

```bash
git add package.json .github/workflows/ci.yml test/contracts/workspace-config.test.js
git commit -m "ci: enforce project source validation"
```

## Task 6: Project Governance Completion Gate

**Files:**
- Modify only if verification exposes a defect

- [ ] **Step 1: Confirm the implementation scope**

Run

```bash
PLAN_COMMIT=$(git log -1 --format=%H -- docs/superpowers/plans/2026-07-17-project-source-of-truth-implementation-plan.md)
git diff --name-only "$PLAN_COMMIT"..HEAD
```

Expected output contains only

```text
.github/workflows/ci.yml
AGENTS.md
README.md
docs/PROJECT_CONTROL_BASELINE.md
docs/project/PROJECT.md
docs/project/checkpoints/CP-20260717-PHASE0-MERGED.md
docs/project/decisions/DEC-0001-project-governance.md
docs/project/templates/checkpoint.md
package.json
scripts/check-project-source.mjs
test/contracts/workspace-config.test.js
test/project-source-of-truth.test.js
```

- [ ] **Step 2: Verify no production or Workflow baseline changed**

Run

```bash
PLAN_COMMIT=$(git log -1 --format=%H -- docs/superpowers/plans/2026-07-17-project-source-of-truth-implementation-plan.md)
git diff --exit-code "$PLAN_COMMIT"..HEAD -- src server public vite.config.js dify-workflows/*.yml dify-workflows/manifest.json packages
```

Expected: exit 0 with no output

- [ ] **Step 3: Run the complete clean gate**

Run

```bash
npm ci
npm run verify
npm run lint
git diff --check
git status --short
```

Expected: all verification counts from Task 5 pass and the final status is empty

- [ ] **Step 4: Simulate invalid governance data without changing tracked files**

Run

```bash
node --test test/project-source-of-truth.test.js
```

Expected: all 6 tests pass, proving the validator rejects missing fields, invalid project and checkpoint states, broken links, duplicate checkpoint IDs and a rejected `last_checkpoint`

- [ ] **Step 5: Review the source as a zero-context Agent**

Using only `AGENTS.md` and `docs/project/PROJECT.md`, confirm the reader can answer

```text
What is the accepted implementation commit
Which phase is current
What work may start next
Which decisions are active
Which risks remain
Where Phase 0 evidence lives
Who may update the current baseline
What blocks dependent work
```

Expected: every answer is explicit without reading thread context

- [ ] **Step 6: Record review evidence in the implementation handoff response**

The final controller handoff must include

```text
Base and HEAD commits
All verification counts
Files changed
Confirmation that production and Workflow baselines are unchanged
Accepted initial checkpoint ID
Next gate ID
Known limitations of structural validation
```

Do not update `PROJECT.md` with its own governance commit hash
