---
checkpoint_id: CP-20260721-PHASE4-PLAN-SUBMITTED
task_id: PHASE4-PLAN
status: submitted
recorded_at: 2026-07-21T22:08:34+08:00
branch: codex/phase4-plan
base_commit: 5a853744dfdef06d08bab6514eb0f022d50937c3
head_commit: 5a853744dfdef06d08bab6514eb0f022d50937c3
supersedes: none
---

# Phase 4 Plan Submitted

## Scope

提交 Phase 4 七任务实施计划，等待 `GATE-PHASE4-PLAN-APPROVED` 的明确用户决策

本 checkpoint 不接受计划、不解锁任何实施任务，也不授权 schema、migration、生产代码、正式数据、部署或切换

## Evidence

- 计划覆盖 contracts、兼容模式、加密持久化、私有 API、事务创建、outbox、lease recovery、旧历史只读 port、Web 工作区和独立验收
- 七个任务按依赖顺序排列并具备明确文件边界、RED/GREEN 步骤、验证命令和升级条件
- 数据库事务、内容加密、outbox 幂等、lease recovery、管理员无内容权限和终态硬删除均具有专门验证
- 正式 SQLite 迁移、新 DSL、外部依赖、部署、UAT、切换和 Phase 5 行为明确排除

## Accepted Result

计划可进入 Gate 审查，只有用户明确通过 `GATE-PHASE4-PLAN-APPROVED` 后才能创建 Task 1 started contract
