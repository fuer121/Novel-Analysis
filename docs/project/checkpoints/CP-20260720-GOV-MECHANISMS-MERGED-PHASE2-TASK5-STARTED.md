---
checkpoint_id: CP-20260720-GOV-MECHANISMS-MERGED-PHASE2-TASK5-STARTED
task_id: PHASE2-TASK5
status: accepted
recorded_at: 2026-07-20T17:47:52+08:00
branch: codex/phase2-task5-l2-scope
base_commit: 01aaa83002a01f58832d3303bfb4d222b0988feb
head_commit: 01aaa83002a01f58832d3303bfb4d222b0988feb
supersedes: none
---

# Governance Mechanisms Merged And Phase 2 Task 5 Started

## Scope

记录治理机制 PR #59 合并后的证据，并启动 Phase 2 Task 5 L2 Index Groups And Scope Contract

### Core Allowed Modules

- `packages/domain/src/library/l2-scope.ts`
- `packages/jobs/src/library/l2-job.ts`
- `apps/api/src/routes/index-groups.ts`
- `packages/database/src/library/index-repository.ts`

### Mechanical Adjacent Scope

- 上述模块的直接测试
- `packages/domain/src/index.ts` 与 `packages/jobs/src/index.ts` 类型及导出入口
- `apps/api/src/app.ts` 既有 runtime wiring
- Task 5 行为直接需要的既有 contracts 类型调整

### Success Criteria

- 完整覆盖 3 个 mode、2 个 force 值、5 个状态和章节范围边界的 scope matrix
- `force` 不改变选择集合，outside-range 永不进入任务
- preview 与 creation 复用同一 selector 和 scope hash，事务内重算发现变化时零副作用拒绝
- 索引组只支持 create、list、coverage，不支持 edit、upsert 或 PATCH
- 创建时冻结 Prompt、Workflow、Schema、adapter contract、admission version 与 index-group config hash
- 每个选中章节创建一个 JobStep，并以 book、group、range、mode 和执行签名组成 concurrency key
- 重复请求和并发创建不得产生重复 job、step、outbox 或 audit 副作用

### Prohibited Changes

- Task 6 L2 executor、facts、subjects 或 admission
- 索引组编辑、upsert 或新增 PATCH endpoint
- migration、新数据表、新外部依赖
- Web、连续提问、分析、Workflow YAML、认证或权限语义
- 正式数据、部署、切换、Phase 2 Gate 或 implementation baseline

### Required Verification

- `npm run test:new -- packages/domain/src/library/l2-scope.test.ts`
- `npm run test:integration -- packages/jobs/src/library/l2-job.integration.test.ts apps/api/src/routes/index-groups.integration.test.ts`
- `npm run verify:implementation`
- `npm run test:project-source`
- `npm run project:check`
- `git diff --check`
- 总控合并前执行 `npm run verify:controller`

### Escalation Conditions

- 需要新增或修改 migration、表或约束
- 需要新增索引组编辑或其他计划外 API
- 需要改变认证、权限、凭证、数据保留或加密语义
- scope matrix、事务边界、并发语义或 Task 5 验收标准需要变化
- Task 6 能力成为 Task 5 的实际依赖
- baseline 状态不再为 `current` 或出现证据冲突

### Resource Budget

- 一个实现 worktree：`~/.config/codex/worktrees/Novel-Analysis/phase2-task5-l2-scope`
- 常规治理节点最多三个，本 checkpoint 合并 Governance Merged 与 Task 5 Started

## Evidence

- 治理机制 PR #59 状态为 MERGED，merge SHA 为 `01aaa83002a01f58832d3303bfb4d222b0988feb`
- PR #59 GitHub Actions `verify` 为 SUCCESS，合并前状态为 CLEAN 与 MERGEABLE
- 合并后 `npm run verify:post-merge` 通过，项目源 41/41，main SHA 与 clean 状态一致
- 已合并治理 worktree 与本地分支由 `workspace:cleanup -- --apply` 安全删除，当前 Task 5 使用唯一外部 worktree
- `baseline_status` 为 `current`，Task 4 merged checkpoint 已解锁 Task 5
- DEC-0008 已固定索引组 create-only 语义

## Accepted Result

治理机制已合并并完成 post-merge 清理，Task 5 可在固定 SHA `01aaa83002a01f58832d3303bfb4d222b0988feb` 上按本 contract 实施

本 checkpoint 不接受 Task 5 实现结果，不更新 implementation baseline，也不提前解锁 Task 6
