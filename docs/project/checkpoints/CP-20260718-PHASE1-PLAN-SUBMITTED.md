---
checkpoint_id: CP-20260718-PHASE1-PLAN-SUBMITTED
task_id: PHASE1-PLAN
status: submitted
recorded_at: 2026-07-18T19:08:42+08:00
branch: docs/phase1-plan-ready
base_commit: 089ecd189c584620a0f9441cbf1a47cfbcd10097
head_commit: 39b7c008a8f42e08c0b8a547a261d6e9417fbb01
supersedes: none
---

# Phase 1 Plan Submission

## Assigned Scope

- Allowed files：Phase 1 详细实施计划、项目唯一信源与本 submitted checkpoint
- Required behavior：将 Phase 1 计划压缩到 6-8 个任务，仅保留数据库事务、OAuth 安全、outbox 幂等和 lease recovery 的高风险实现细节
- Prohibited changes：不得开始 Phase 1 编码，不得接受阶段 Gate，不得修改实现基线，不得推送、合并或执行不可逆操作

## Actual Changes

- Phase 1 计划从 15 个任务精简为 8 个任务
- 移除 Playwright、视觉回归、生产部署拓扑、逐包 registry 等值约束和低风险辅助实现源码
- 保留真实 PostgreSQL、Kysely migrations、OAuth/Session/RBAC/Audit、持久任务、outbox、lease、SSE、最小 Web 与跨进程恢复演示
- Gate 顺序修正为先接受 `GATE-PHASE1-PLAN-APPROVED`，再实施 8 个任务

## Verification Evidence

| 检查项 | 命令或证据 | 结果 |
| --- | --- | --- |
| 任务数量 | `rg -c '^### Task' docs/superpowers/plans/2026-07-18-phase-1-collaboration-task-kernel-implementation-plan.md` | 8 |
| 文档格式 | `git diff --check 1b2049b 39b7c00` | passed |
| 提交范围 | `git diff --name-status 1b2049b 39b7c00` | 仅 Phase 1 计划文件 |
| 保护范围 | `git diff --exit-code 089ecd1 39b7c00 -- docs/project package-lock.json server src test/service.test.js dify-workflows/*.yml` | 无差异 |
| 精简审计 | 必要任务、可合并任务、越界内容、过早细节和 Gate 顺序审计 | 15 个任务建议压缩为 8 个 |
| 聚焦审查 | 一次聚焦规范审查 | 4 个一致性问题已局部修正并由总控 spot-check |

## Plan Deviations

- 用户要求采用最小复杂度，因此未继续要求低风险部分提供完整实现源码，也未重复执行两阶段重型审查

## Risks And Blockers

- `GATE-PHASE1-PLAN-APPROVED` 尚未由用户确认，Phase 1 实施保持阻塞
- 依赖具体版本在实施 Task 1 时通过 lockfile 与兼容性验证确定，不在计划阶段过早冻结 registry 最新值

## User Feedback

- 可逆的工程实现、任务拆分和测试策略由总控自主决定
- 范围扩张、架构变化、数据与安全策略、阶段 Gate、PR 合并或不可逆操作必须暂停确认
- 低风险改动不重复执行重型审查流程

## Decisions Required

- 请求用户确认是否接受 `GATE-PHASE1-PLAN-APPROVED`

## Recommended Next Action

用户审阅精简后的 8 任务 Phase 1 计划；确认 Gate 后，由总控为 Task 1 创建实施 contract 和独立 worktree

## Acceptance Request

请求总控与用户核验计划范围、风险边界、Gate 顺序和以上证据，并决定接受、拒绝或要求补充证据
