---
project_id: novel-analysis-refactor
source_version: 1
baseline_commit: be49f4ccd312a269ee4c7419c6d9d08407df2c21
baseline_status: current
updated_at: 2026-07-19T05:03:12+08:00
updated_by: controller-agent
current_phase: phase-1-implementation
last_checkpoint: CP-20260719-PHASE1-TASK6-MERGED
next_gate: GATE-PHASE1-IMPLEMENTATION-ACCEPTED
---

# Novel Analysis Refactor Project Source

本文档是项目状态、基线、决策、风险和推进条件的唯一入口，线程上下文不能替代本文档

## Current Baseline

| 字段 | 当前值 |
| --- | --- |
| Repository | fuer121/Novel-Analysis |
| Branch | main |
| Accepted implementation baseline | `be49f4ccd312a269ee4c7419c6d9d08407df2c21` |
| Pull request | PR #1 `https://github.com/fuer121/Novel-Analysis/pull/1` |
| CI | passed |
| Legacy application | 旧应用只是兼容基线，不是重构前端 |
| Dify workflow | [Workflow](../../dify-workflows/manifest.json) |

## Phase Status

| 阶段 | 状态 | 证据或依赖 |
| --- | --- | --- |
| Phase 0 | merged | [CP-20260717-PHASE0-MERGED](checkpoints/CP-20260717-PHASE0-MERGED.md) |
| Phase 1 | implementation | [CP-20260718-PHASE1-PLAN-MERGED](checkpoints/CP-20260718-PHASE1-PLAN-MERGED.md) |
| Phase 2 | blocked by Phase 1 | Phase 1 通过后才能推进 |
| Phase 3 | blocked by Phase 2 | Phase 2 通过后才能推进 |

## Active Work

| Task | Phase | Scope | Owner | Branch | Base | Head | Status | Depends On | Checkpoint | Next Action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PHASE1-PLAN | phase-1 | Phase 1 detailed implementation plan | controller-agent | main | 089ecd189c584620a0f9441cbf1a47cfbcd10097 | 4ad103ca48442820904842047cd95b8924d44590 | merged | CP-20260718-GOV-POST-MERGE-RECONCILIATION | CP-20260718-PHASE1-PLAN-MERGED | complete |
| PHASE1-TASK1 | phase-1 | Foundation contracts and workspaces | controller-agent | main | 4ad103ca48442820904842047cd95b8924d44590 | 8f4f56728f6b3cc395bcf5f07f576aba48d3a275 | merged | CP-20260718-PHASE1-PLAN-MERGED | CP-20260718-PHASE1-TASK1-MERGED | complete |
| PHASE1-TASK2 | phase-1 | PostgreSQL schema and Kysely migrations | controller-agent | main | fc146c3c5b722ee9659561feef7b278b7d06094a | 86ec324b373be1de451bef64219360afcfdc75ef | merged | CP-20260718-PHASE1-TASK1-MERGED | CP-20260718-PHASE1-TASK2-MERGED | complete |
| PHASE1-TASK3 | phase-1 | OAuth, session, RBAC and audit | controller-agent | main | 86ec324b373be1de451bef64219360afcfdc75ef | e6d52c93b5bf4b40aeb940d72206599d1ce8780a | merged | CP-20260718-PHASE1-TASK2-MERGED | CP-20260719-PHASE1-TASK3-MERGED | complete |
| PHASE1-TASK4 | phase-1 | Persistent job API and audited controls | controller-agent | main | e6d52c93b5bf4b40aeb940d72206599d1ce8780a | b4b8c92232d195ba53ae6e18d5f204f95c9cfdd4 | merged | CP-20260719-PHASE1-TASK3-MERGED | CP-20260719-PHASE1-TASK4-MERGED | complete |
| PHASE1-TASK5 | phase-1 | Transactional outbox and pg-boss dispatcher | controller-agent | main | b4b8c92232d195ba53ae6e18d5f204f95c9cfdd4 | fd51657889a7748bc90a4641f3fa51f6dcb1526a | merged | CP-20260719-PHASE1-TASK4-MERGED | CP-20260719-PHASE1-TASK5-MERGED | complete |
| PHASE1-TASK6 | phase-1 | Lease recovery and worker runtime | controller-agent | main | fd51657889a7748bc90a4641f3fa51f6dcb1526a | 84c3770f29ad97bcb1f4b71ce9afdf5021dbf1dc | merged | CP-20260719-PHASE1-TASK5-MERGED | CP-20260719-PHASE1-TASK6-MERGED | complete |
| PHASE1-TASK7 | phase-1 | Persisted SSE and minimal web | unassigned | none | 84c3770f29ad97bcb1f4b71ce9afdf5021dbf1dc | none | ready | CP-20260719-PHASE1-TASK6-MERGED | none | create task contract and isolated worktree |

## Effective Decisions

- [DEC-0001 Controller-Owned Project Source](decisions/DEC-0001-project-governance.md) 确立项目治理信源与权限边界
- [DEC-0002 Automated Pull Request Authority](decisions/DEC-0002-automated-pull-request-authority.md) 授权总控在全部低风险合并条件满足时自动创建、审查、合并 PR 并推进下一个已批准任务
- [已批准设计](../superpowers/specs/2026-07-16-novel-analysis-refactor-design.md) 是重构范围和架构的有效依据
- 完整重构完成后再切换，不长期双维护旧应用与重构应用
- 目标场景为 5-20 人 LAN 使用，采用飞书登录、共享书库以及管理员和成员角色
- 技术路线为 React、TypeScript、模块化单体、PostgreSQL、pg-boss 和 Dify executor
- 核心分析路径为核心书库 → L1 → L2 → L2 连续提问
- Task 3 OAuth 使用 5 分钟 browser correlation Cookie、固定飞书 endpoint redirect fail-closed 与事务化 current-CSRF logout；该安全补强由用户于 2026-07-19 明确授权，并以 [Task 3 accepted checkpoint](checkpoints/CP-20260719-PHASE1-TASK3-ACCEPTED.md) 为证据
- Task 6 将 `completed`、`failed`、`cancelled` 统一为不可覆盖终态；用户于 2026-07-19 明确授权移除既有 `failed -> queued` 迁移，并以 [Task 6 accepted checkpoint](checkpoints/CP-20260719-PHASE1-TASK6-ACCEPTED.md) 为证据

## Risks And Blockers

- `npm audit` 当前有 1 low、1 moderate、1 high、2 critical，修复需要单独授权
- GitHub Actions 依赖尚未固定到完整 SHA
- `2026-07-17 controller main worktree /api/health observation: Dify and OpenAI are not configured; this is environment-specific and not a project-wide architecture fact`

## Pending Feedback

- 无

## Next Gate

下一个阶段门禁为 `GATE-PHASE1-IMPLEMENTATION-ACCEPTED`；`PHASE1-TASK6` 已合并完成，当前可执行任务为 `PHASE1-TASK7`，应基于 `84c3770f29ad97bcb1f4b71ce9afdf5021dbf1dc` 创建 task contract 和独立 worktree

## Evidence Index

- [项目唯一信源治理设计](../superpowers/specs/2026-07-17-project-source-of-truth-design.md)
- [重构路线图](../superpowers/plans/2026-07-16-novel-analysis-refactor-roadmap.md)
- [Phase 0 handoff](../superpowers/handoffs/2026-07-17-phase-0-foundation-handoff.md)
- [Phase 0 accepted checkpoint](checkpoints/CP-20260717-PHASE0-MERGED.md)
- [Governance source post-merge reconciliation](checkpoints/CP-20260718-GOV-POST-MERGE-RECONCILIATION.md)
- [Phase 1 plan submitted checkpoint](checkpoints/CP-20260718-PHASE1-PLAN-SUBMITTED.md)
- [Phase 1 plan approved checkpoint](checkpoints/CP-20260718-PHASE1-PLAN-APPROVED.md)
- [Phase 1 plan merged checkpoint](checkpoints/CP-20260718-PHASE1-PLAN-MERGED.md)
- [Phase 1 Task 1 accepted checkpoint](checkpoints/CP-20260718-PHASE1-TASK1-ACCEPTED.md)
- [Phase 1 Task 1 merged checkpoint](checkpoints/CP-20260718-PHASE1-TASK1-MERGED.md)
- [Phase 1 Task 2 accepted checkpoint](checkpoints/CP-20260718-PHASE1-TASK2-ACCEPTED.md)
- [Phase 1 Task 2 merged checkpoint](checkpoints/CP-20260718-PHASE1-TASK2-MERGED.md)
- [Phase 1 Task 3 accepted checkpoint](checkpoints/CP-20260719-PHASE1-TASK3-ACCEPTED.md)
- [Phase 1 Task 3 merged checkpoint](checkpoints/CP-20260719-PHASE1-TASK3-MERGED.md)
- [Phase 1 Task 4 accepted checkpoint](checkpoints/CP-20260719-PHASE1-TASK4-ACCEPTED.md)
- [Phase 1 Task 4 merged checkpoint](checkpoints/CP-20260719-PHASE1-TASK4-MERGED.md)
- [Phase 1 Task 5 accepted checkpoint](checkpoints/CP-20260719-PHASE1-TASK5-ACCEPTED.md)
- [Phase 1 Task 5 merged checkpoint](checkpoints/CP-20260719-PHASE1-TASK5-MERGED.md)
- [Phase 1 Task 6 accepted checkpoint](checkpoints/CP-20260719-PHASE1-TASK6-ACCEPTED.md)
- [Phase 1 Task 6 merged checkpoint](checkpoints/CP-20260719-PHASE1-TASK6-MERGED.md)
- [Legacy project control baseline](../PROJECT_CONTROL_BASELINE.md)

## Update Protocol

1. 执行 Agent 只提交反馈和证据，不直接更新本信源
2. 总控 Agent 核验提交内容并记录状态
3. 只有状态为 `accepted` 的结果可以推进项目基线和阶段
4. 证据冲突时将状态设为 `conflicted` 或 `blocked` 并暂停推进
5. 治理提交不更新 `baseline_commit`，只有实现基线变化时才更新
6. PR 自动化权限、前置条件和强制暂停边界以 `DEC-0002` 为唯一依据，不得从线程上下文扩张权限
