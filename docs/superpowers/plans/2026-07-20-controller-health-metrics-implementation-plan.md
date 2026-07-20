# Controller Health Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking

**Goal:** 提供一个只读、离线、确定性的总控健康报告，让每次 post-merge checkpoint 都能看到工作区和项目信源是否持续符合 DEC-0007

**Architecture:** 新增 `scripts/controller-health.mjs`，复用 `auditWorkspace` 收集 Git/worktree 数据，并独立读取 `PROJECT.md` 的行数与 Active Work 行数。命令只输出观察值和布尔信号，始终不修改状态、不调用 GitHub、不引入强制 Gate

**Tech Stack:** Node.js ESM、`node:test`、现有 workspace audit 与 npm scripts

---

### Task 1: Read-only controller health report

**Files:**
- Create: `scripts/controller-health.mjs`
- Create: `test/controller-health.test.js`
- Modify: `package.json`
- Modify: `docs/project/PROJECT.md`
- Create: `docs/project/checkpoints/CP-20260720-CONTROLLER-HEALTH-METRICS-ACCEPTED.md`

- [x] **Step 1: Write failing focused tests**

测试纯函数 `summarizeControllerHealth`，固定验证以下指标

```js
assert.deepEqual(summary.workspace, {
  mainClean: true,
  additionalWorktrees: 1,
  dirtyWorktrees: 0,
  localBranches: 2,
  nodeModulesCopies: 1,
  nodeModulesKb: 256,
  repositoryWorktreeKb: 0,
});
assert.deepEqual(summary.projectSource, {
  lines: 120,
  activeWorkRows: 1,
});
```

另一个测试验证缺失 main worktree 时 `mainClean` 为 `false`，并验证 `formatControllerHealth` 的稳定文本字段

- [x] **Step 2: Run tests and verify RED**

Run: `node --test test/controller-health.test.js`

Expected: FAIL because `scripts/controller-health.mjs` does not exist

- [x] **Step 3: Implement the minimal report**

实现并导出

```js
export function summarizeControllerHealth(audit, projectContent) {}
export function formatControllerHealth(summary) {}
export async function collectControllerHealth(cwd = process.cwd()) {}
```

CLI 默认输出稳定文本，`--json` 输出 JSON；两种模式均为只读且不根据指标设置非零退出码

- [x] **Step 4: Wire the command into existing verification**

在 `package.json` 增加

```json
"controller:health": "node scripts/controller-health.mjs"
```

并将 `verify:post-merge` 扩展为在既有检查之后执行 `npm run controller:health`

- [x] **Step 5: Record acceptance without changing Phase 2 gates**

新增 accepted checkpoint，记录指标定义、验证证据和只读边界；更新 `PROJECT.md` 的 latest checkpoint 与 Evidence Index，不改变 implementation baseline、Active Work、Next Gate 或 Task 6 状态

- [x] **Step 6: Verify GREEN and scope**

Run:

```bash
node --test test/controller-health.test.js
npm run test:workspace
npm run test:project-source
npm run project:check
npm run controller:health -- --json
npm run verify:post-merge
git diff --check
```

Expected: all checks pass, health JSON contains only repository-local observations, and changed files match this task contract

- [x] **Step 7: Commit**

```bash
git add scripts/controller-health.mjs test/controller-health.test.js package.json docs/project/PROJECT.md docs/project/checkpoints/CP-20260720-CONTROLLER-HEALTH-METRICS-ACCEPTED.md docs/superpowers/plans/2026-07-20-controller-health-metrics-implementation-plan.md
git commit -m "chore: add controller health metrics"
```
