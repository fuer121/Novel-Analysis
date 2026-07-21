---
checkpoint_id: CP-20260721-PHASE3-TASK2-STARTED
task_id: PHASE3-TASK2
status: accepted
recorded_at: 2026-07-21T09:43:06+08:00
branch: codex/phase3-task2-started
base_commit: 9928ac334659cc6c3c877ab70724db5b391ee923
head_commit: 9928ac334659cc6c3c877ab70724db5b391ee923
supersedes: none
---

# Phase 3 Task 2 Started

## Scope

### Core Allowed Modules

- `packages/database/src/migrations/006_continuous_queries.ts`
- `packages/database/src/query/query-repository.ts`
- `packages/database/src/query/query-repository.integration.test.ts`
- `packages/database/src/migrations/index.ts`
- `packages/database/src/db.ts`
- `packages/database/src/library/index-repository.ts`
- `packages/database/src/index.ts`
- `packages/database/src/schema.integration.test.ts`

### Mechanical Adjacent Scope

- directly corresponding database tests, types and package exports
- migration registry and schema roundtrip fixtures
- existing database test helpers required to construct encrypted Query rows
- no package manifest, lockfile or dependency changes

### Approved Data Objects

- `query_sessions`：单 book、单 L2 group、owner、private/team visibility、默认章节范围、密文 title 与 archive metadata
- `query_turns`：密文 question/answer、question HMAC、范围、intent/source/gap/config JSON、execution signature、evidence snapshot hash、status、job/attempt 引用与 degradation
- `turn_evidence`：不可变 `turn_id + fact_id` 引用、rank、recall reason、disposition 与 exclusion reason
- `workflow_versions_target_check` 仅扩展仓库已有 `analysis-summary` target

不得新增第四张 Query 表、成员级 ACL、跨索引组关系或计划外数据对象

### Success Criteria

- session title、turn question 和 answer 完成密文 roundtrip，普通列和 JSON 列不出现明文
- session 默认范围合法且固定一个 book 和一个 L2 index group
- private session 仅 owner/admin 可读，team session 对同书库团队成员可读
- shared member 可读取并创建自己的 turn，但不能 rename、share、archive 或管理他人 turn
- repository 在返回授权对象前完成访问判断，调用方不能先读取密文字段再自行授权或解密
- turn 与 evidence 在同一 transaction 失败时完整回滚，不产生孤儿记录
- evidence 首次提交形成不可变 snapshot，二次提交被拒绝
- migration up/down roundtrip 后三张 Query 表、索引和 workflow target constraint 一致
- 现有 library/index repository、Phase 1/2 schema 与运行行为保持不变

### Prohibited Changes

- Query API、jobs、Worker、Web 或 Phase 3 Tasks 3-7
- Dify YAML、manifest、credential 或真实 key
- 新外部依赖、package manifest 或 lockfile
- destructive migration、正式数据操作、部署或切换
- 新认证语义、成员级 ACL、跨索引组会话或 Gate/验收标准变化
- 修改既有 L1/L2 事实准入、索引语义或 Phase 2 Gate

### Required Verification

- schema、密文 roundtrip、transaction、authorization 和 immutable evidence 的可观察 RED
- `npm run test:integration -- packages/database/src/query/query-repository.integration.test.ts packages/database/src/schema.integration.test.ts`
- `npm run typecheck:phase2`
- `npm run lint`
- `git diff --check`
- plaintext sentinel scan 和 scope audit
- independent specification review and code-quality review
- controller `npm run verify:controller` before merge
- post-merge focused integration smoke and `npm run verify:post-merge`

### Escalation Conditions

- 三张批准表不足以满足 repository contract，或需要新增数据对象、表、外键语义或 destructive migration
- ciphertext、transaction、authorization 或 evidence immutability 需要改变既有安全与数据策略
- 需要 API、jobs、Worker、Web、Dify YAML、依赖或凭证变化
- schema/index 无法满足既定 10 用户并发与 read threshold，必须改变已批准验收标准
- question、answer、session title、fact body 或 credential 进入普通列、JSON、日志或错误
- Gate、任务顺序、正式数据、部署、切换或其他不可逆操作发生变化
- baseline 变为 stale、conflicted 或 blocked

## Evidence

- PHASE3-TASK1 已通过 PR #80 合并并由 `CP-20260721-PHASE3-TASK1-MERGED` 接受
- main 与 origin/main 对齐于 `9928ac334659cc6c3c877ab70724db5b391ee923` 且主工作区 clean
- Phase 3 Plan Gate 已批准 Task 2 的三张 Query 表、密文 repository 与分享权限边界
- 用户于 2026-07-21 明确要求按计划推进下一步
- 当前 baseline_status 为 `current`，无证据冲突或阻塞

## Accepted Result

PHASE3-TASK2 may proceed from the final merge SHA of this Started Contract using TDD, one implementation worktree and independent specification and code-quality review

This checkpoint does not accept Task 2, unlock Task 3, execute formal data migration, change a Gate or authorize deployment
