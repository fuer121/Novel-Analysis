---
decision_id: DEC-0006
status: accepted
recorded_at: 2026-07-20T09:44:25+08:00
confidence: high
scope: phase2-task4-contract-correction
supersedes: none
---

# Phase 2 Task 4 Contract Correction

## Context

Task 4 实现前核验发现原 allowed scope 无法完成已批准行为：Task 3 自动 handoff 只创建空 L1 job，Worker 不分派 `l1-index` step，运行时未装配 L1 credential，且 `prompt_versions` 未保存 adapter 所需的 Prompt 正文

实现 Agent 在写 RED 测试前停止，固定 worktree 保持 clean，未产生实现或未授权变更

## Decision

- 扩大 Task 4 allowed scope，允许修改 `packages/jobs/src/library/import-job.ts` 及其 integration test，以幂等方式把自动 handoff 展开为完整 L1 job、steps 与 outbox
- 允许修改 `apps/worker/src/worker.ts`、`apps/worker/src/main.ts` 及既有 Worker integration test，使 `l1-index` step 进入 library executor，并通过 `DIFY_L1_WORKFLOW_API_KEY` 装配 accepted Dify adapter
- 允许新增 `packages/database/src/migrations/004_prompt_content.ts`，修改 migration registry 与数据库类型，为不可变 Prompt 版本保存实际正文
- 新 migration 必须可逆且兼容已有行；已有无正文版本可以保留，但 L1 preview 或创建必须 fail-closed，禁止向 provider 发送空 Prompt
- Prompt 正文可进入专用 `prompt_versions.content` 与冻结的 job config snapshot，不得进入 job scope、event、audit、日志、错误或 step output reference
- Prompt content hash 必须与正文一致，L1 创建冻结 Prompt、Workflow、Schema 与 adapter contract version，executor 只能使用冻结 snapshot
- 原 Task 4 coverage、事务重算、单章 step、原子提交、恢复、幂等和明文保护 contract 保持不变

## Evidence

- `packages/jobs/src/library/import-job.ts` 的 `createImportL1Handoff` 只创建 total 为零的 queued job，没有 step 或 outbox
- `apps/worker/src/worker.ts` 只将 `chapter-import` 分派给 library executor，其他 kind 进入 example executor
- `apps/worker/src/main.ts` 将 L1 credential 固定为 `unused`
- `packages/database/src/db.ts` 的 `prompt_versions` 只有 version 与 content hash，而 accepted `DifyAdapter.runL1Index` 要求实际 `indexPrompt`
- 用户于 2026-07-20 明确授权总控采用最小完整修复方案

## Consequences

- Task 4 在 correction checkpoint 合并后可按修正 contract 重新委派并继续严格 TDD
- 本决策不授权 L2、Web、query、analysis、正式数据、部署、切换或 Phase 2 Gate 变化
- migration 只演进重构数据库结构，不执行正式数据迁移或线上操作
- Task 5 在 Task 4 merged checkpoint 前继续锁定

## Source

本决策来源于实现前的代码证据、总控复核以及用户对最小完整修复方案的明确授权
