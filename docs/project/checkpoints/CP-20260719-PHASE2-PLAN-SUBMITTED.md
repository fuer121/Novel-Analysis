---
checkpoint_id: CP-20260719-PHASE2-PLAN-SUBMITTED
task_id: PHASE2-PLAN
status: submitted
recorded_at: 2026-07-19T16:09:43+08:00
branch: main
base_commit: 201e1e74ee18e1ce08b93211d3652c4c8a90ef21
head_commit: fbd944bd85e9eb9e319a22dd547877b42a81ca61
supersedes: none
---

# Phase 2 Plan Submission

## Assigned Scope

- Allowed files：Phase 2 设计、实施计划和本次项目治理记录
- Required behavior：以共享书库、章节导入、L1 与 L2 索引为范围，提供 contract-first、垂直切片且可验证的 Phase 2 计划
- Prohibited changes：不得开始 Phase 2 编码，不得读取或迁移正式 SQLite 数据，不得修改线上 Workflow YAML，不得接受阶段 Gate、部署或切换

## Actual Changes

- 新增 Phase 2 书库与索引设计，明确不迁移旧 SQLite、仅覆盖 chapter import、L1 和 L2，连续提问保留到 Phase 3
- 新增 Task 0 至 Task 8 实施计划，以 Task 0 固化 Dify golden contract、JobStep 粒度和 freshness matrix
- 保留数据库事务、Dify 契约、加密事实、outbox 幂等、lease recovery、规模验证与真实 scope/coverage 验收
- PR #27 已合并到 `main`，Merge SHA 为 `fbd944bd85e9eb9e319a22dd547877b42a81ca61`

## Verification Evidence

| 检查项 | 命令或证据 | 结果 |
| --- | --- | --- |
| 任务数量 | `rg -c '^## [0-9]+. Task' docs/superpowers/plans/2026-07-19-phase-2-library-indexing-implementation-plan.md` | 9，Task 0 至 Task 8 |
| 占位符扫描 | `rg -n 'TBD|TODO|待定|类似 Task|Task 9|性能合理'` | 仅设计文档中禁止“性能合理”的约束命中 |
| 文档格式 | `git diff --check` | passed |
| PR 范围 | PR #27 files | 仅 Phase 2 设计与实施计划 |
| CI | GitHub Actions `verify` | passed，1m22s |
| 合并状态 | PR #27 | merged |
| 本地主线 | `git rev-parse main origin/main` | 均为 `fbd944bd85e9eb9e319a22dd547877b42a81ca61` |

## Plan Deviations

无报告

## Risks And Blockers

- `GATE-PHASE2-PLAN-APPROVED` 尚未接受，Phase 2 实施保持阻塞
- Task 0 必须先验证一章一个 JobStep 在 3、100、3000 章规模下成立；若否决该模型，必须停下修订计划并重新过 Gate
- 正式数据、部署、迁移和切换仍不在 Phase 2 授权范围

## User Feedback

- 用户确认 Phase 2 采用最小复杂度、contract-first 和垂直切片路线
- 用户确认采用 Subagent-Driven 实施方式，但该方式只能在计划 Gate 通过后启动

## Decisions Required

- 请求用户明确接受或拒绝 `GATE-PHASE2-PLAN-APPROVED`

## Recommended Next Action

用户核验 Phase 2 设计、Task 0 至 Task 8 计划和本 checkpoint；Gate 通过后，总控以 `fbd944bd85e9eb9e319a22dd547877b42a81ca61` 为 Phase 2 计划基点创建 Task 0 contract 和独立 worktree

## Acceptance Request

请求用户确认 `GATE-PHASE2-PLAN-APPROVED`；本 submitted checkpoint 不自行接受 Gate，也不授权 Phase 2 实施
