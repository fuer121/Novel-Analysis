---
checkpoint_id: CP-20260720-PHASE2-TASK4-CONTRACT-CORRECTED
task_id: PHASE2-TASK4
status: accepted
recorded_at: 2026-07-20T09:44:25+08:00
branch: refactor/phase2-task4-l1
base_commit: f8a7291f3c5bd1fb2300573368a267b52c31d228
head_commit: f8a7291f3c5bd1fb2300573368a267b52c31d228
supersedes: CP-20260720-PHASE2-TASK4-STARTED
---

# Phase 2 Task 4 Contract Corrected

## Scope

修正 Task 4 started contract 的 allowed scope，使已批准的自动 L1 handoff、真实 Worker 执行和冻结 Prompt 正文具备完整实现路径

除原八个 Task 4 文件外，允许修改：

- `packages/jobs/src/library/import-job.ts`
- `packages/jobs/src/library/import-job.integration.test.ts`
- `apps/worker/src/worker.ts`
- `apps/worker/src/main.ts`
- `packages/database/src/db.ts`
- `packages/database/src/migrations/index.ts`
- 新增 `packages/database/src/migrations/004_prompt_content.ts`

禁止 L2、Web、query、analysis、Workflow YAML、正式数据、部署、切换和 Phase 2 Gate 变化

## Evidence

- 首次实现委派在 RED 编辑前发现三项 contract 与代码现状冲突并停止，worktree 无 diff、无 commit
- 总控独立复核确认空 handoff job、缺失 Worker L1 分派、未装配 credential 以及 Prompt 正文缺口均真实存在
- 用户明确授权采用总控建议的最小完整修复方案
- [DEC-0006](../decisions/DEC-0006-phase2-task4-contract-correction.md) 固定新增范围、数据模型和运行配置边界

## Corrected Task Contract

- 原 `CP-20260720-PHASE2-TASK4-STARTED` 的所有 required behavior 继续有效
- 自动 handoff 与手动 L1 创建必须复用同一 selector、scopeHash、snapshot、steps 与 outbox 创建语义
- Worker 必须显式分派 `l1-index`，缺失或部分 L1 runtime config 必须 fail-closed 且保持错误脱敏
- Prompt 正文保存于不可变版本记录并冻结进 job config；正文与 content hash 必须一致
- 新 migration 必须可逆并兼容已有行；无正文版本不得创建可执行 L1 job
- Prompt 正文不得进入 scope、event、audit、日志、错误或 output reference

## Accepted Result

Task 4 可继续在原固定 worktree 与 SHA `f8a7291f3c5bd1fb2300573368a267b52c31d228` 实施修正后的 contract

本 checkpoint 不接受实现结果，不更新 implementation baseline，也不提前解锁 Task 5
