---
project_id: novel-analysis-refactor
source_version: 1
baseline_commit: 4b4cc227e9540f5a0764ae476c54a2090aa54a24
baseline_status: current
updated_at: 2026-07-20T22:56:29+08:00
updated_by: controller-agent
current_phase: phase-2-implementation
last_checkpoint: CP-20260720-PHASE2-TASK8-MERGED
next_gate: GATE-PHASE2-IMPLEMENTATION-ACCEPTED
---

# Novel Analysis Refactor Project Source

本文档是项目当前状态、基线、决策、风险和推进条件的唯一入口，线程上下文不能替代本文档，历史任务与证据由阶段 ledger 承载

## Current Baseline

| 字段 | 当前值 |
| --- | --- |
| Repository | fuer121/Novel-Analysis |
| Branch | main |
| Accepted implementation baseline | `4b4cc227e9540f5a0764ae476c54a2090aa54a24` |
| Latest merged implementation | PR #73 `https://github.com/fuer121/Novel-Analysis/pull/73` |
| CI | passed |
| Legacy application | 旧应用只是兼容基线，不是重构前端 |
| Dify workflow | [Workflow](../../dify-workflows/manifest.json) |
| Controller health | `npm run controller:health`，只读并已纳入 post-merge verification |

## Phase Status

| 阶段 | 状态 | 证据或依赖 |
| --- | --- | --- |
| Phase 0 | merged | [Phase 0 merged](checkpoints/CP-20260717-PHASE0-MERGED.md) |
| Phase 1 | merged | [Phase 1 merged](checkpoints/CP-20260719-PHASE1-MERGED.md) |
| Phase 2 | gate_pending | Task 0 至 Task 8 已合并，等待 Phase 2 Gate 明确确认 |
| Phase 3 | blocked | Phase 2 Gate 通过后才能推进 |

## Active Work

| Task | Phase | Scope | Owner | Branch | Base | Head | Status | Depends On | Checkpoint | Next Action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PHASE2-TASK8 | phase-2 | Scale, recovery and Phase 2 acceptance | controller-agent | main | 11f55a26d2b4de42cde7addcc0aa6e4dda07e17f | 4b4cc227e9540f5a0764ae476c54a2090aa54a24 | merged | CP-20260720-PHASE2-TASK7-MERGED | CP-20260720-PHASE2-TASK8-MERGED | request explicit Phase 2 Gate confirmation |

## Phase Ledgers

- [Phase 1 ledger](ledgers/phase-1-ledger.md)
- [Phase 2 ledger](ledgers/phase-2-ledger.md)

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
- 当前无阻塞 Phase 2 Gate 决策的证据冲突

## Pending Feedback

无，等待用户明确确认 `GATE-PHASE2-IMPLEMENTATION-ACCEPTED`

## Next Gate

下一阶段门禁为 `GATE-PHASE2-IMPLEMENTATION-ACCEPTED`，Task 6 至 Task 8 完成前不得进入 Phase 3

## Evidence Index

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
