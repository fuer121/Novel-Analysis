---
checkpoint_id: CP-20260722-PHASE4-TASK6-MERGED-TASK7-STARTED
task_id: PHASE4-TASK7
status: accepted
recorded_at: 2026-07-22T19:17:08+08:00
branch: codex/phase4-task7-acceptance-evidence
base_commit: 2f30844340d7cf2d91c1fcd545b14912fe8d03dd
head_commit: 2f30844340d7cf2d91c1fcd545b14912fe8d03dd
supersedes: none
---

# Phase 4 Task 6 Merged And Task 7 Started

## Scope

记录 PHASE4-TASK6 实现合并，并接受 PHASE4-TASK7 的 Independent Phase 4 Acceptance And Security Evidence Task Contract

### Core Allowed Modules

- `test/phase4/**`
- `vitest.phase4.config.ts`
- `package.json` 中直接 Phase 4 验证脚本
- Task 7 直接使用的 acceptance fixtures

### Mechanical Adjacent Scope

- 直接测试 helper、process harness、deterministic Dify fake、fixture exports 与测试类型
- 复用现有 Phase 1/2/3 process、PostgreSQL、auth 与 provider 测试基础设施，不改变其产品语义
- 复用 Task 6 viewport verifier 与截图产物，不新增浏览器依赖
- 仅为让已批准验收行为可执行而进行的测试 wiring，不得修改产品 runtime

### Success Criteria

- 独立 harness 启动真实 API 与 Worker、disposable PostgreSQL、deterministic Dify fake，并捕获 API/Worker logs
- four-mode golden matrix 验证 source counts、chapter reader calls、default review budget、complete snapshot、encrypted result 与 export projection
- Worker 在一个 committed part 后终止、lease 过期、restart 与 outbox replay 时只复用已完成 part，重复 create 只产生一个 terminal result
- 另一个 member 与 administrator 不能 enumerate 或读取 owner templates、runs 与 results；administrator metadata endpoint 只能控制 Job 且无内容字段
- active delete 被拒绝；cancel 后 terminal owner delete 删除 business graph 但保留 audit；其他 actor 被拒绝
- fixture legacy list/detail 保持 read-only，所有 legacy mutation route 不存在
- plaintext 与 credential sentinel 扫描覆盖 persisted rows、普通 analysis/Job JSON、captured API/Worker logs、events、outbox、attempts 与 controlled provider errors；只有授权解密响应允许出现 plaintext sentinel
- 1440、1280、768 与 390 viewport 无 overlap、root horizontal scroll、missing/internal clipping，segmented controls、drawer、result 与 task controls 可访问
- 完整 Phase 4 与 controller verification 全部通过，无未解决 Critical 或 Important finding

### Prohibited Changes

- 任何 `apps/**`、`packages/**`、legacy runtime 或产品行为修改
- 新 API、数据对象、表、migration、依赖、认证、权限、凭证、加密、队列、retry、lease、outbox 或删除语义
- 为让测试通过而放宽 assertion、隐藏 plaintext、跳过真实 API/Worker/PostgreSQL 或引入 test-only 产品 fallback
- 正式数据、部署、UAT、切换、Phase 4 Gate、验收标准或任务顺序变化

### Required Verification

- RED/GREEN evidence for harness、four-mode、recovery、privacy、delete、legacy、sentinel 与 viewport cases
- `npm run test:phase4:e2e`
- `npm run test:legacy`
- `npm run test:contracts`
- `npm run test:new`
- `npm run test:integration`
- `npm run test:project-source`
- `npm run project:check`
- `npm run lint`
- `npm run typecheck:phase3`
- `git diff --check`、scope audit 与 clean worktree
- independent specification review followed by code-quality and security evidence review
- controller full verification and CI before merge
- post-merge `npm run test:phase4:e2e`、`npm run verify:post-merge`、main SHA 与 clean state

### Escalation Conditions

- 验收暴露产品缺陷，需要修改 runtime、contract、database、security、Worker、queue 或 UI
- sentinel 在非授权解密响应以外的任何位置出现，或扫描范围无法覆盖批准的持久化与日志表面
- recovery 或 idempotency 不能由现有行为证明
- deterministic fake 与真实 API/Worker 路径无法兼容而需要产品 fallback
- viewport 验收需要新依赖或 UI 架构变化
- Gate、验收标准、任务顺序、正式数据、部署或切换变化
- baseline becomes stale、conflicted or blocked

## Evidence

- PR #126 accepted checkpoint merged at `209a70c844ef51e352d827f3662e1225803229b9`
- PR #125 implementation merged at `2f30844340d7cf2d91c1fcd545b14912fe8d03dd`
- post-merge Web smoke 51/51、viewport verifier 4/4、Job/Worker PostgreSQL focused smoke 43/43 通过
- `npm run verify:post-merge` 通过，project source 42、project check、workspace audit 与 controller health 正常
- main 与 origin/main 同为 `2f30844340d7cf2d91c1fcd545b14912fe8d03dd`，main worktree clean
- accepted Phase 4 plan 固定 Task 7 为独立验收证据任务，不允许改变产品行为或自行通过 Gate

## Accepted Result

PHASE4-TASK6 is merged and PHASE4-TASK7 may proceed from the final governance merge SHA using TDD、one external implementation worktree and independent reviews

This checkpoint does not accept Task 7、pass `GATE-PHASE4-IMPLEMENTATION-ACCEPTED`、authorize formal data operations、deployment or cutover
