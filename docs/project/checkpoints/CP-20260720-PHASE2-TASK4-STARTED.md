---
checkpoint_id: CP-20260720-PHASE2-TASK4-STARTED
task_id: PHASE2-TASK4
status: accepted
recorded_at: 2026-07-20T09:16:31+08:00
branch: refactor/phase2-task4-l1
base_commit: f8a7291f3c5bd1fb2300573368a267b52c31d228
head_commit: f8a7291f3c5bd1fb2300573368a267b52c31d228
supersedes: none
---

# Phase 2 Task 4 Started

## Scope

启动已批准计划中的 L1 Build And Coverage，固定实现基线和 task contract

允许新增 L1 job selector/service，扩展 books API、library executor 与 index repository 及其真实 PostgreSQL tests

禁止 L2、Web、query、analysis、migration、Workflow YAML、正式数据、部署、切换和 Phase 2 Gate 变化

## Evidence

- Task 3 已合并并通过 focused PostgreSQL、CI 与 merged checkpoint
- 当前 `main` 与 `origin/main` 均为 `f8a7291f3c5bd1fb2300573368a267b52c31d228`
- `baseline_status` 为 `current`，Task 4 已解锁
- Task 4 固定采用 Subagent-Driven Development、严格 TDD、独立规格与质量审查
- 主工作区用户 `.DS_Store` 修改必须保持未触碰

## Task Contract

- coverage 将每章恰好归入 fresh、missing、failed、stale，且 Task 0 每个 L1 signature 字段变化只产生矩阵定义的 stale
- preview 与 creation 共享 selector 和 scopeHash；creation 在事务内重算，不一致零副作用拒绝
- job config snapshot 冻结 Prompt、Workflow、Schema、adapter contract 与章节 freshness 输入；每章一个 step
- queued auto-L1 handoff 必须由 Task 4 安全展开为 steps/outbox，不重复、不扩大 scope
- executor 只在内存解密单章正文，调用 L1 adapter 后完整校验；L1 history/current、step output reference、progress 与 event 原子提交
- fresh chapter 不调用 provider；provider/结构失败产生精确 gap；迟到、重复、cancel 与 recovery 保持单效果
- event、scope、config、output reference、audit、日志和错误不得包含正文或 route body

## Accepted Result

Task 4 可在独立 worktree 基于固定 SHA `f8a7291f3c5bd1fb2300573368a267b52c31d228` 开始实施

本 checkpoint 不接受实现结果，不更新 implementation baseline，也不提前解锁 Task 5
