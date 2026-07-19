---
checkpoint_id: CP-20260719-PHASE2-TASK3-STARTED
task_id: PHASE2-TASK3
status: accepted
recorded_at: 2026-07-19T23:31:42+08:00
branch: refactor/phase2-task3-import
base_commit: 1fa158bf39af1cfadc51517fbb0733c439e65628
head_commit: 1fa158bf39af1cfadc51517fbb0733c439e65628
supersedes: none
---

# Phase 2 Task 3 Started

## Scope

启动已批准计划中的 Book Creation And Chapter Import Slice，固定实现基线和 task contract

允许新增 import job selector、书籍与导入 API routes、单章 library executor 及其真实 PostgreSQL integration tests，并连接现有 Worker、API config 与 jobs exports

禁止 L1 构建与 coverage、L2 构建、前端、query、analysis、Workflow YAML、正式数据、SQLite 迁移、部署、切换和 Phase 2 Gate 变化

## Evidence

- Task 2 已合并并通过真实 PostgreSQL、contracts、CI 与 merged checkpoint 验证
- 当前 `main` 与 `origin/main` 均为 `1fa158bf39af1cfadc51517fbb0733c439e65628`
- `baseline_status` 为 `current`，Pending Feedback 明确 Task 3 已解锁
- Task 3 固定采用 Subagent-Driven Development、严格 TDD、独立规格审查、独立质量审查和总控验证
- 主工作区用户 `.DS_Store` 修改存在且必须保持未触碰

## Task Contract

- import preview 与 job creation 必须共享相同 selector/query contract，返回 requested、existing fresh、existing stale、executable counts 与稳定 `scopeHash`
- 创建任务时必须重新计算 scope；状态变化导致 hash 不一致时返回稳定 `scope_changed`，不得静默扩大或缩小执行范围
- 书籍/source 更新使用显式事务；job、每章一个 step、created event 与 initial outbox 使用另一个单事务
- member 与 admin 可创建书籍和发起导入；稳定 `Idempotency-Key` 必须继续生效
- executor 单章调用 adapter，完整校验后计算 HMAC、加密并提交章节与 chapter reference；事件、step output 与日志不得包含正文
- adapter 或结构失败不得留下章节行；签名匹配的章节直接 skipped 且不得调用 provider
- `autoStartL1` 必须在 import job 创建时快照；只有导入完全成功才创建 L1 handoff，部分失败只暴露缺口
- pause、cancel、lease recovery 和重复执行必须保持单章单效果，不得绕过 Phase 1 终态与事务规则

## Accepted Result

Task 3 可在独立 worktree 基于固定 SHA `1fa158bf39af1cfadc51517fbb0733c439e65628` 开始实施

本 checkpoint 不接受任何实现结果，不更新 implementation baseline，也不提前解锁 Task 4
