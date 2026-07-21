---
project_id: novel-analysis-refactor
source_version: 1
baseline_commit: d6820b6ef40aa257c6cf492bce29819a82c59ce1
baseline_status: current
updated_at: 2026-07-21T19:03:43+08:00
updated_by: controller-agent
current_phase: phase-3-implementation
last_checkpoint: CP-20260721-PHASE3-TASK7-STARTED
next_gate: GATE-PHASE3-IMPLEMENTATION-ACCEPTED
---

# Novel Analysis Refactor Project Source

本文档是项目当前状态、基线、决策、风险和推进条件的唯一入口，线程上下文不能替代本文档，历史任务与证据由阶段 ledger 承载

## Current Baseline

| 字段 | 当前值 |
| --- | --- |
| Repository | fuer121/Novel-Analysis |
| Branch | main |
| Accepted implementation baseline | `d6820b6ef40aa257c6cf492bce29819a82c59ce1` |
| Latest merged implementation | PR #98 `https://github.com/fuer121/Novel-Analysis/pull/98` |
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
| Phase 3 | implementing | Task 1-6 merged，Task 7 ready |

## Active Work

| Task | Phase | Scope | Owner | Branch | Base | Head | Status | Depends On | Checkpoint | Next Action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PHASE3-TASK7 | phase-3 | Independent acceptance, concurrency and security evidence | implementation-agent | codex/phase3-task7-acceptance | f701e648d19cd8e1c22ac98d385acdbba81cfd35 | none | in_progress | CP-20260721-PHASE3-TASK6-MERGED | CP-20260721-PHASE3-TASK7-STARTED | merge Started Contract, then create one implementation worktree and begin independent RED |

## Phase Ledgers

- [Phase 1 ledger](ledgers/phase-1-ledger.md)
- [Phase 2 ledger](ledgers/phase-2-ledger.md)
- [Phase 3 ledger](ledgers/phase-3-ledger.md)

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

无，PHASE3-TASK7 Started Contract 已接受，等待治理 PR 合并后创建实现 worktree

## Next Gate

下一阶段门禁为 `GATE-PHASE3-IMPLEMENTATION-ACCEPTED`，Task 1 至 Task 7 完成前不得通过

## Evidence Index

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
