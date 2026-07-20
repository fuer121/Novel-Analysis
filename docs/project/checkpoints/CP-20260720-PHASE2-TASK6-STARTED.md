---
checkpoint_id: CP-20260720-PHASE2-TASK6-STARTED
task_id: PHASE2-TASK6
status: accepted
recorded_at: 2026-07-20T19:18:23+08:00
branch: codex/phase2-task6-l2-executor
base_commit: f61eda1ab494e8c4c370a9cb3196a3b62939d4e7
head_commit: f61eda1ab494e8c4c370a9cb3196a3b62939d4e7
supersedes: none
---

# Phase 2 Task 6 Started

## Scope

### Core Allowed Modules

- `packages/domain/src/library/l2-admission.ts`
- `apps/worker/src/library-executor.ts`
- `packages/database/src/library/index-repository.ts`

### Mechanical Adjacent Scope

- 上述模块的直接测试
- `packages/domain/src/index.ts` 导出入口
- `apps/worker/src/worker.ts` 既有 step routing 与 runtime config
- `apps/worker/src/main.ts` 既有 Dify credential wiring

### Success Criteria

- 固定 golden admission 行为，包括神奇生物排除、未确定候选保留、候选晋升、artifact/material rejection 与 Prompt/index-group 隔离
- L2 executor 只使用冻结 snapshot，读取匹配章节与 current L1 route，解密正文后调用 L2 adapter，并验证章节绑定与 Schema
- accepted facts 的 body 使用既有 AES-256-GCM cipher 加密，明文不进入普通列、job scope、step output、事件、日志或错误
- facts、subjects、章节状态、step、attempt、job progress、event 与后续 outbox 在明确事务边界形成单效果
- 结构失败不提交 facts，记录精确 failed gap；业务拒绝提交 fresh status 与准入计数，不伪装为 Provider failure
- 替换结果只在事务提交时生效，旧 facts 在新结果提交前保持可审计
- duplicate completion、过期 attempt、cancelled late result 与 replay 不重复 facts、subjects、coverage、progress、events 或 outbox
- production Worker 以既有 fail-closed 配置模式装配 L2 credential，不改变凭证存储、日志或错误脱敏策略

### Prohibited Changes

- migration、新表、新数据对象、现有数据库约束或加密策略变化
- Fact category allowlist、Dify DSL、adapter contract、Task 5 scope 或 index-group create-only 语义变化
- API、Web、fact review、连续提问、Task 7、Task 8 或新的用户可见能力
- 认证、权限、凭证存储、正式数据、部署、切换、Phase 2 Gate 或验收标准变化

### Required Verification

- `npm run test:new -- packages/domain/src/library/l2-admission.test.ts`
- focused PostgreSQL：`apps/worker/src/library-executor.integration.test.ts` 与 `packages/database/src/library/index.integration.test.ts`
- Worker runtime config 与 step routing focused tests
- `npm run verify:legacy`
- `npm run verify:implementation`
- `npm run test:project-source`
- `npm run project:check`
- `git diff --check`
- 总控合并前执行 `npm run verify:controller`

### Escalation Conditions

- 需要 migration、新表、约束、外部依赖或新增 category
- 需要改变 adapter/DSL、加密、认证、权限、凭证存储或错误暴露语义
- 现有表无法同时满足结果替换历史与原子提交
- admission golden fixture 存在冲突，或需要扩大到计划外专项规则
- Task 7/8 能力成为 Task 6 实际依赖
- baseline 不再为 `current`，或并发、lease、CI 与本地证据发生冲突

### Resource Budget

- 一个实现 worktree：`~/.config/codex/worktrees/Novel-Analysis/phase2-task6-l2-executor`
- 常规治理节点使用 Started Contract、Implementation Acceptance、Merged Checkpoint 三类以内

## Evidence

- Task 5 PR #62 已合并，Task 6 依赖 checkpoint 已接受
- Task 2 migration 已包含 `l2_chapter_statuses`、`l2_facts`、`l2_subjects` 与 fact encryption 字段，无需 schema 变化
- Task 5 job snapshot 已冻结 Prompt、Workflow、Schema、admission version、index-group config、章节 freshness 与 L1 signature
- 既有 Dify adapter 已声明并验证 `runL2Index` contract
- Stage 7 后稳态健康指标为主工作区 clean、零附加 worktree、零 dirty、一个本地分支与一条 Active Work

## Accepted Result

Phase 2 Task 6 可在固定基线 `f61eda1ab494e8c4c370a9cb3196a3b62939d4e7` 上按本 contract 实施

本 checkpoint 不接受 Task 6 实现，不更新 implementation baseline，也不解锁 Task 7
