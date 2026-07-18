---
project_id: novel-analysis-refactor
source_version: 1
baseline_commit: be49f4ccd312a269ee4c7419c6d9d08407df2c21
baseline_status: current
updated_at: 2026-07-18T20:34:19+08:00
updated_by: controller-agent
current_phase: phase-1-implementation-ready
last_checkpoint: CP-20260718-PHASE1-PLAN-APPROVED
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
| Phase 1 | plan approved, awaiting governance merge | [CP-20260718-PHASE1-PLAN-APPROVED](checkpoints/CP-20260718-PHASE1-PLAN-APPROVED.md) |
| Phase 2 | blocked by Phase 1 | Phase 1 通过后才能推进 |
| Phase 3 | blocked by Phase 2 | Phase 2 通过后才能推进 |

## Active Work

| Task | Phase | Scope | Owner | Branch | Base | Head | Status | Depends On | Checkpoint | Next Action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PHASE1-PLAN | phase-1 | Phase 1 detailed implementation plan | controller-agent | docs/phase1-plan-ready | 089ecd189c584620a0f9441cbf1a47cfbcd10097 | 39b7c008a8f42e08c0b8a547a261d6e9417fbb01 | accepted | CP-20260718-GOV-POST-MERGE-RECONCILIATION | CP-20260718-PHASE1-PLAN-APPROVED | merge governance PR after user confirmation |
| PHASE1-TASK1 | phase-1 | Foundation contracts and workspaces | unassigned | none | none | none | blocked | PHASE1-PLAN governance merged to main | none | wait for governance PR merge |

## Effective Decisions

- [DEC-0001 Controller-Owned Project Source](decisions/DEC-0001-project-governance.md) 确立项目治理信源与权限边界
- [已批准设计](../superpowers/specs/2026-07-16-novel-analysis-refactor-design.md) 是重构范围和架构的有效依据
- 完整重构完成后再切换，不长期双维护旧应用与重构应用
- 目标场景为 5-20 人 LAN 使用，采用飞书登录、共享书库以及管理员和成员角色
- 技术路线为 React、TypeScript、模块化单体、PostgreSQL、pg-boss 和 Dify executor
- 核心分析路径为核心书库 → L1 → L2 → L2 连续提问

## Risks And Blockers

- `npm audit` 当前有 1 low、1 moderate、1 high、2 critical，修复需要单独授权
- GitHub Actions 依赖尚未固定到完整 SHA
- `JobProgress` 的当前进度可以超过 `total`
- 拒绝迁移矩阵和诊断断言等待 Phase 1 处理
- `2026-07-17 controller main worktree /api/health observation: Dify and OpenAI are not configured; this is environment-specific and not a project-wide architecture fact`

## Pending Feedback

- `CP-20260718-PHASE1-PLAN-APPROVED` 已接受，Task 1 等待本治理分支合并到 `main`

## Next Gate

下一个阶段门禁为 `GATE-PHASE1-IMPLEMENTATION-ACCEPTED`；当前操作门禁为治理 PR 合并确认，合并前不得开始 Task 1

## Evidence Index

- [项目唯一信源治理设计](../superpowers/specs/2026-07-17-project-source-of-truth-design.md)
- [重构路线图](../superpowers/plans/2026-07-16-novel-analysis-refactor-roadmap.md)
- [Phase 0 handoff](../superpowers/handoffs/2026-07-17-phase-0-foundation-handoff.md)
- [Phase 0 accepted checkpoint](checkpoints/CP-20260717-PHASE0-MERGED.md)
- [Governance source post-merge reconciliation](checkpoints/CP-20260718-GOV-POST-MERGE-RECONCILIATION.md)
- [Phase 1 plan submitted checkpoint](checkpoints/CP-20260718-PHASE1-PLAN-SUBMITTED.md)
- [Phase 1 plan approved checkpoint](checkpoints/CP-20260718-PHASE1-PLAN-APPROVED.md)
- [Legacy project control baseline](../PROJECT_CONTROL_BASELINE.md)

## Update Protocol

1. 执行 Agent 只提交反馈和证据，不直接更新本信源
2. 总控 Agent 核验提交内容并记录状态
3. 只有状态为 `accepted` 的结果可以推进项目基线和阶段
4. 证据冲突时将状态设为 `conflicted` 或 `blocked` 并暂停推进
5. 治理提交不更新 `baseline_commit`，只有实现基线变化时才更新
