---
project_id: novel-analysis-refactor
source_version: 1
baseline_commit: 0eaf4b5430cd56de01caa39f470c73ccb97782c5
baseline_status: current
updated_at: 2026-07-23T16:38:25+08:00
updated_by: controller-agent
current_phase: phase-5-plan-approved
last_checkpoint: CP-20260723-PHASE5-TASK6-REPEATABILITY-AUDIT-AUTHORIZED
next_gate: GATE-PHASE5-TOOLS-ACCEPTED
---

# Novel Analysis Refactor Project Source

本文档是项目当前状态、基线、决策、风险和推进条件的唯一入口，线程上下文不能替代本文档，历史任务与证据由阶段 ledger 承载

## Current Baseline

| 字段 | 当前值 |
| --- | --- |
| Repository | fuer121/Novel-Analysis |
| Branch | main |
| Accepted implementation baseline | `0eaf4b5430cd56de01caa39f470c73ccb97782c5` |
| Latest merged implementation | PR #146 `https://github.com/fuer121/Novel-Analysis/pull/146` |
| CI | passed |
| Legacy application | 旧应用只是兼容基线，不是重构前端 |
| Dify workflow | [Workflow](../../dify-workflows/manifest.json) |
| Controller health | `npm run controller:health`，只读并已纳入 post-merge verification |

## Phase Status

| 阶段 | 状态 | 证据或依赖 |
| --- | --- | --- |
| Phase 0 | merged | [Phase 0 merged](checkpoints/CP-20260717-PHASE0-MERGED.md) |
| Phase 1 | merged | [Phase 1 merged](checkpoints/CP-20260719-PHASE1-MERGED.md) |
| Phase 2 | accepted | `GATE-PHASE2-IMPLEMENTATION-ACCEPTED` 已通过 |
| Phase 3 | accepted | `GATE-PHASE3-IMPLEMENTATION-ACCEPTED` 已通过 |
| Phase 4 | accepted | `GATE-PHASE4-IMPLEMENTATION-ACCEPTED` 已通过 |
| Phase 5 | active | 8 项工程任务已批准；正式数据、部署、UAT 与切换未授权 |

## Active Work

| Task | Phase | Scope | Owner | Branch | Base | Head | Status | Depends On | Checkpoint | Next Action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PHASE5-TASK6 | phase-5 | Production-scale capacity harness with controlled provider | implementation-agent | codex/phase5-task6 | 66e1f4d5d4ea98b611dc6556c748234e077f82a3 | 6029dfbb0eab27f6fd30c12310425473ffc754c2 | in_progress | CP-20260723-PHASE5-TASK5-MERGED-TASK6-STARTED | CP-20260723-PHASE5-TASK6-REPEATABILITY-AUDIT-AUTHORIZED | run five unchanged artifact repetitions and report all results；no code changes |

## Phase Ledgers

- [Phase 1 ledger](ledgers/phase-1-ledger.md)
- [Phase 2 ledger](ledgers/phase-2-ledger.md)
- [Phase 3 ledger](ledgers/phase-3-ledger.md)
- [Phase 4 ledger](ledgers/phase-4-ledger.md)

## Effective Decisions

- [DEC-0001 Controller-Owned Project Source](decisions/DEC-0001-project-governance.md)
- [DEC-0002 Automated Pull Request Authority](decisions/DEC-0002-automated-pull-request-authority.md)
- [DEC-0003 One Chapter Per JobStep](decisions/DEC-0003-phase2-step-granularity.md)
- [DEC-0004 Dify Smoke Credential Policy](decisions/DEC-0004-dify-smoke-credential-policy.md)
- [DEC-0005 Repository L2 Workflow Output Alignment](decisions/DEC-0005-repository-l2-workflow-output-alignment.md)
- [DEC-0006 Phase 2 Task 4 Contract Correction](decisions/DEC-0006-phase2-task4-contract-correction.md)
- [DEC-0007 Controller Workspace And Governance Lifecycle](decisions/DEC-0007-controller-workspace-and-governance-lifecycle.md)
- [DEC-0008 Phase 2 Task 5 Index Group Create Only](decisions/DEC-0008-phase2-task5-index-group-create-only.md)
- [DEC-0009 Phase 2 Task 5 Workflow Snapshot Boundary](decisions/DEC-0009-phase2-task5-workflow-snapshot-boundary.md)
- [DEC-0010 Index Group Category Scope](decisions/DEC-0010-index-group-category-scope.md)
- [DEC-0011 Task 7 Fact Review API](decisions/DEC-0011-task7-fact-review-api.md)
- [DEC-0012 Task 7 Session Cache Boundary](decisions/DEC-0012-task7-session-cache-boundary.md)
- [DEC-0013 Phase 3 Query Session Sharing](decisions/DEC-0013-phase3-query-session-sharing.md)
- [DEC-0014 Query HMAC Key Policy](decisions/DEC-0014-query-hmac-key-policy.md)
- [DEC-0015 Query Turn History And Trace Projection](decisions/DEC-0015-query-turn-history-and-trace-projection.md)
- [DEC-0016 Encrypted Advanced Analysis Execution Snapshot](decisions/DEC-0016-phase4-encrypted-execution-snapshot.md)
- [DEC-0017 Phase 5 Selective Migration And No Entry Rollback](decisions/DEC-0017-phase5-selective-migration-and-no-entry-rollback.md)
- [DEC-0018 Phase 5 Shared Freshness Selector Ownership](decisions/DEC-0018-phase5-shared-freshness-selector.md)
- [DEC-0019 Phase 5 Rebuild Reorder Temporary Positions](decisions/DEC-0019-phase5-rebuild-reorder-positive-temporary-positions.md)
- [已批准重构设计](../superpowers/specs/2026-07-16-novel-analysis-refactor-design.md)
- 完整重构完成后再切换，不长期双维护旧应用与重构应用
- 目标场景为 5-20 人 LAN 使用，采用飞书登录、共享书库以及管理员和成员角色
- 技术路线为 React、TypeScript、模块化单体、PostgreSQL、pg-boss 和 Dify executor
- 核心分析路径为核心书库 → L1 → L2 → L2 连续提问

## Risks And Blockers

- `npm audit` 当前有 1 low、1 moderate、1 high、2 critical，修复需要单独授权
- GitHub Actions 依赖尚未固定到完整 SHA
- PostgreSQL BIGINT event ID 当前映射为 JavaScript `number`，后续 contract 演进需要单独授权
- Task 2 UUID cursor 在 cursor row 被删除时会提前结束分页，当前阶段没有 fact 删除路径
- Fact category allowlist 在 contracts 与 database 分别维护，后续 category contract 演进必须同步验证
- Query API 运行环境必须提供独立的 canonical-base64 32-byte `CONTENT_HMAC_KEY`，且不得与内容加密 key 相同
- Task 7 的 10 用户 p95 阈值是本地 fake-provider 验收证据，不代表生产容量承诺
- Task 7 plaintext 与 credential sentinel 扫描必须覆盖持久化、普通 Query JSON、captured API/Worker logs 与受控 provider error

## Pending Feedback

Phase 5 Tasks 1-5已合并并post-merge verified；Task 6已授权五次不改代码与threshold的重复性审计，原blocked证据仍有效；Task 7、Task 8与所有正式操作未解锁

## Next Gate

下一阶段门禁为 `GATE-PHASE5-TOOLS-ACCEPTED`，只有 Tasks 1 至 8 全部 accepted 并 merged 后才可请求明确 Gate 决策

## Evidence Index

- [Phase 5 Task 6 repeatability audit authorized](checkpoints/CP-20260723-PHASE5-TASK6-REPEATABILITY-AUDIT-AUTHORIZED.md)
- [Phase 5 Task 6 blocked](checkpoints/CP-20260723-PHASE5-TASK6-BLOCKED.md)
- [Phase 5 Task 5 merged and Task 6 started](checkpoints/CP-20260723-PHASE5-TASK5-MERGED-TASK6-STARTED.md)
- [Phase 5 Task 5 accepted](checkpoints/CP-20260723-PHASE5-TASK5-ACCEPTED.md)
- [Phase 5 Task 5 reorder correction](checkpoints/CP-20260723-PHASE5-TASK5-REORDER-CORRECTION.md)
- [Phase 5 Task 5 started](checkpoints/CP-20260723-PHASE5-TASK5-STARTED.md)
- [Phase 5 Task 4 merged](checkpoints/CP-20260723-PHASE5-TASK4-MERGED.md)
- [Phase 5 Task 4 accepted](checkpoints/CP-20260723-PHASE5-TASK4-ACCEPTED.md)
- [Phase 5 Task 4 unblocked](checkpoints/CP-20260723-PHASE5-TASK4-UNBLOCKED.md)
- [Phase 5 shared freshness selector decision](decisions/DEC-0018-phase5-shared-freshness-selector.md)
- [Phase 5 Task 4 blocked](checkpoints/CP-20260723-PHASE5-TASK4-BLOCKED.md)
- [Phase 5 Task 3 merged and Task 4 started](checkpoints/CP-20260723-PHASE5-TASK3-MERGED-TASK4-STARTED.md)
- [Phase 5 Task 3 accepted](checkpoints/CP-20260723-PHASE5-TASK3-ACCEPTED.md)
- [Phase 5 Task 2 merged and Task 3 started](checkpoints/CP-20260723-PHASE5-TASK2-MERGED-TASK3-STARTED.md)
- [Phase 5 Task 2 accepted](checkpoints/CP-20260723-PHASE5-TASK2-ACCEPTED.md)
- [Phase 5 Task 1 merged and Task 2 started](checkpoints/CP-20260723-PHASE5-TASK1-MERGED-TASK2-STARTED.md)
- [Phase 5 Task 1 accepted](checkpoints/CP-20260723-PHASE5-TASK1-ACCEPTED.md)
- [Phase 5 Task 1 started](checkpoints/CP-20260723-PHASE5-TASK1-STARTED.md)
- [Phase 5 plan approved](checkpoints/CP-20260723-PHASE5-PLAN-APPROVED.md)
- [Phase 5 plan submitted](checkpoints/CP-20260723-PHASE5-PLAN-SUBMITTED.md)
- [Phase 5 implementation plan](../superpowers/plans/2026-07-23-phase-5-migration-cutover-implementation-plan.md)
- [Phase 5 design accepted](checkpoints/CP-20260723-PHASE5-DESIGN-ACCEPTED.md)
- [Phase 5 selective migration decision](decisions/DEC-0017-phase5-selective-migration-and-no-entry-rollback.md)
- [Phase 5 design submitted](checkpoints/CP-20260723-PHASE5-DESIGN-SUBMITTED.md)
- [Phase 5 migration and cutover design](../superpowers/specs/2026-07-23-phase-5-migration-cutover-design.md)
- [Phase 4 implementation accepted](checkpoints/CP-20260722-PHASE4-IMPLEMENTATION-ACCEPTED.md)
- [Phase 4 Task 7 merged](checkpoints/CP-20260722-PHASE4-TASK7-MERGED.md)
- [Phase 4 Task 7 accepted](checkpoints/CP-20260722-PHASE4-TASK7-ACCEPTED.md)
- [Phase 4 Task 6 merged and Task 7 started](checkpoints/CP-20260722-PHASE4-TASK6-MERGED-TASK7-STARTED.md)
- [Phase 4 Task 6 accepted](checkpoints/CP-20260722-PHASE4-TASK6-ACCEPTED.md)
- [Phase 4 Task 6 Worker correction](checkpoints/CP-20260722-PHASE4-TASK6-WORKER-CORRECTION.md)
- [Phase 4 Task 6 contract correction](checkpoints/CP-20260722-PHASE4-TASK6-CONTRACT-CORRECTION.md)
- [Phase 4 Task 5 merged and Task 6 started](checkpoints/CP-20260722-PHASE4-TASK5-MERGED-TASK6-STARTED.md)
- [Phase 4 Task 5 accepted](checkpoints/CP-20260722-PHASE4-TASK5-ACCEPTED.md)
- [Phase 4 Task 4 merged and Task 5 started](checkpoints/CP-20260722-PHASE4-TASK4-MERGED-TASK5-STARTED.md)
- [Phase 4 Task 4 accepted](checkpoints/CP-20260722-PHASE4-TASK4-ACCEPTED.md)
- [Phase 4 Task 3 merged and Task 4 started](checkpoints/CP-20260722-PHASE4-TASK3-MERGED-TASK4-STARTED.md)
- [Phase 4 Task 3 accepted](checkpoints/CP-20260722-PHASE4-TASK3-ACCEPTED.md)
- [Phase 4 Task 3 contract correction](checkpoints/CP-20260722-PHASE4-TASK3-CONTRACT-CORRECTION.md)
- [Encrypted advanced analysis execution snapshot decision](decisions/DEC-0016-phase4-encrypted-execution-snapshot.md)
- [Phase 4 Task 2 merged and Task 3 started](checkpoints/CP-20260722-PHASE4-TASK2-MERGED-TASK3-STARTED.md)
- [Phase 4 Task 2 accepted](checkpoints/CP-20260722-PHASE4-TASK2-ACCEPTED.md)
- [Phase 4 Task 1 merged and Task 2 started](checkpoints/CP-20260721-PHASE4-TASK1-MERGED-TASK2-STARTED.md)
- [Phase 4 Task 1 accepted](checkpoints/CP-20260721-PHASE4-TASK1-ACCEPTED.md)
- [Phase 4 Task 1 started](checkpoints/CP-20260721-PHASE4-TASK1-STARTED.md)
- [Phase 4 plan approved](checkpoints/CP-20260721-PHASE4-PLAN-APPROVED.md)
- [Phase 4 ledger](ledgers/phase-4-ledger.md)
- [Phase 4 plan submitted](checkpoints/CP-20260721-PHASE4-PLAN-SUBMITTED.md)
- [Phase 4 implementation plan](../superpowers/plans/2026-07-21-phase-4-advanced-analysis-implementation-plan.md)
- [Phase 4 design accepted](checkpoints/CP-20260721-PHASE4-DESIGN-ACCEPTED.md)
- [Phase 4 design submitted](checkpoints/CP-20260721-PHASE4-DESIGN-SUBMITTED.md)
- [Phase 4 design](../superpowers/specs/2026-07-21-phase-4-advanced-analysis-design.md)
- [Phase 3 implementation accepted](checkpoints/CP-20260721-PHASE3-IMPLEMENTATION-ACCEPTED.md)
- [Phase 3 Task 7 merged](checkpoints/CP-20260721-PHASE3-TASK7-MERGED.md)
- [Phase 3 Task 7 accepted](checkpoints/CP-20260721-PHASE3-TASK7-ACCEPTED.md)
- [Phase 3 Task 7 started](checkpoints/CP-20260721-PHASE3-TASK7-STARTED.md)
- [Phase 3 Task 6 merged](checkpoints/CP-20260721-PHASE3-TASK6-MERGED.md)
- [Phase 3 Task 6 accepted](checkpoints/CP-20260721-PHASE3-TASK6-ACCEPTED.md)
- [Phase 3 Task 6 API correction merged](checkpoints/CP-20260721-PHASE3-TASK6-API-CORRECTION-MERGED.md)
- [Phase 3 Task 6 API correction accepted](checkpoints/CP-20260721-PHASE3-TASK6-API-CORRECTION-ACCEPTED.md)
- [Phase 3 Task 6 API correction started](checkpoints/CP-20260721-PHASE3-TASK6-API-CORRECTION-STARTED.md)
- [Phase 3 Task 6 started](checkpoints/CP-20260721-PHASE3-TASK6-STARTED.md)
- [Phase 3 Task 5 merged](checkpoints/CP-20260721-PHASE3-TASK5-MERGED.md)
- [Phase 3 Task 5 accepted](checkpoints/CP-20260721-PHASE3-TASK5-ACCEPTED.md)
- [Phase 3 Task 5 started](checkpoints/CP-20260721-PHASE3-TASK5-STARTED.md)
- [Phase 3 Task 4 merged](checkpoints/CP-20260721-PHASE3-TASK4-MERGED.md)
- [Phase 3 Task 4 accepted](checkpoints/CP-20260721-PHASE3-TASK4-ACCEPTED.md)
- [Phase 3 Task 4 started](checkpoints/CP-20260721-PHASE3-TASK4-STARTED.md)
- [Phase 3 Task 3 merged](checkpoints/CP-20260721-PHASE3-TASK3-MERGED.md)
- [Phase 3 Task 3 accepted](checkpoints/CP-20260721-PHASE3-TASK3-ACCEPTED.md)
- [Phase 3 Task 3 started](checkpoints/CP-20260721-PHASE3-TASK3-STARTED.md)
- [Phase 3 Task 2 merged](checkpoints/CP-20260721-PHASE3-TASK2-MERGED.md)
- [Phase 3 Task 2 accepted](checkpoints/CP-20260721-PHASE3-TASK2-ACCEPTED.md)
- [Phase 3 Task 2 started](checkpoints/CP-20260721-PHASE3-TASK2-STARTED.md)
- [Phase 3 Task 1 merged](checkpoints/CP-20260721-PHASE3-TASK1-MERGED.md)
- [Phase 3 Task 1 accepted](checkpoints/CP-20260721-PHASE3-TASK1-ACCEPTED.md)
- [Phase 3 Task 1 started](checkpoints/CP-20260721-PHASE3-TASK1-STARTED.md)
- [Phase 3 plan approved](checkpoints/CP-20260721-PHASE3-PLAN-APPROVED.md)
- [Phase 3 plan submitted](checkpoints/CP-20260721-PHASE3-PLAN-SUBMITTED.md)
- [Phase 3 design accepted](checkpoints/CP-20260721-PHASE3-DESIGN-ACCEPTED.md)
- [Phase 3 design submitted](checkpoints/CP-20260721-PHASE3-DESIGN-SUBMITTED.md)
- [Phase 2 implementation accepted](checkpoints/CP-20260720-PHASE2-IMPLEMENTATION-ACCEPTED.md)
- [Phase 2 Task 8 merged](checkpoints/CP-20260720-PHASE2-TASK8-MERGED.md)
- [Phase 2 Task 8 accepted](checkpoints/CP-20260720-PHASE2-TASK8-ACCEPTED.md)
- [Phase 2 Task 8 started](checkpoints/CP-20260720-PHASE2-TASK8-STARTED.md)
- [Phase 2 Task 7 merged](checkpoints/CP-20260720-PHASE2-TASK7-MERGED.md)
- [Phase 2 Task 7 accepted](checkpoints/CP-20260720-PHASE2-TASK7-ACCEPTED.md)
- [Phase 2 Task 7 session cache correction](checkpoints/CP-20260720-PHASE2-TASK7-SESSION-CACHE-CORRECTION.md)
- [Phase 2 Task 7 contract correction](checkpoints/CP-20260720-PHASE2-TASK7-CONTRACT-CORRECTION.md)
- [Phase 2 Task 7 started](checkpoints/CP-20260720-PHASE2-TASK7-STARTED.md)
- [Phase 2 Task 6 merged](checkpoints/CP-20260720-PHASE2-TASK6-MERGED.md)
- [Phase 2 Task 6 accepted](checkpoints/CP-20260720-PHASE2-TASK6-ACCEPTED.md)
- [Phase 2 Task 6 contract correction](checkpoints/CP-20260720-PHASE2-TASK6-CONTRACT-CORRECTION.md)
- [Phase 2 Task 6 started](checkpoints/CP-20260720-PHASE2-TASK6-STARTED.md)
- [Controller health metrics accepted](checkpoints/CP-20260720-CONTROLLER-HEALTH-METRICS-ACCEPTED.md)
- [Task 5 merged and project ledgers accepted](checkpoints/CP-20260720-PHASE2-TASK5-MERGED-PROJECT-LEDGERS.md)
- [Phase 1 ledger](ledgers/phase-1-ledger.md)
- [Phase 2 ledger](ledgers/phase-2-ledger.md)
- [项目唯一信源治理设计](../superpowers/specs/2026-07-17-project-source-of-truth-design.md)
- [重构路线图](../superpowers/plans/2026-07-16-novel-analysis-refactor-roadmap.md)
- [Legacy project control baseline](../PROJECT_CONTROL_BASELINE.md)

## Update Protocol

1. 执行 Agent 只提交反馈和证据，不直接更新本信源
2. 总控 Agent 核验提交内容并记录状态
3. 只有状态为 `accepted` 的结果可以推进项目基线和阶段
4. 证据冲突时将状态设为 `conflicted` 或 `blocked` 并暂停推进
5. 治理提交不更新 `baseline_commit`，只有实现基线变化时才更新
6. 已完成任务写入对应阶段 ledger，`PROJECT.md` 只保留当前任务和下一动作
7. PR 自动化权限、前置条件和强制暂停边界以 `DEC-0002` 为唯一依据，不得从线程上下文扩张权限
