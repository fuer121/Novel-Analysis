---
checkpoint_id: CP-20260720-PHASE2-TASK5-ACCEPTED
task_id: PHASE2-TASK5
status: accepted
recorded_at: 2026-07-20T18:19:47+08:00
branch: codex/phase2-task5-l2-scope
base_commit: 373782cd46598ff6c3270569143c7893f4c17f1c
head_commit: 96913e59550cfc82597d53152da3235d002ec737
supersedes: none
---

# Phase 2 Task 5 Accepted

## Scope

- 新增穷举 L2 scope matrix 的纯 selector
- 新增 create-only index-group API、列表与 freshness-aware coverage
- 新增共享 preview selector 与事务化 L2 job creation
- 冻结 Prompt、Workflow、Schema、adapter contract、admission version、index-group config、L1 signature 与章节 freshness 输入到 job snapshot
- 每个选中章节创建一个 JobStep，并用冻结执行签名合并并发重复任务

Mechanical adjacent scope 实际使用直接测试、domain/jobs 导出入口与 API app wiring，未修改 database schema、migration registry 或其他业务模块

## Evidence

- TDD RED：scope 模块缺失、L2 job 模块缺失、index-group routes 404、并发唯一约束冲突、range-local coverage 错误和 Workflow freshness coverage 错误均先被测试复现
- `npm run test:new -- packages/domain/src/library/l2-scope.test.ts`：32/32 通过
- focused PostgreSQL jobs/API：2 个文件、5/5 通过
- `npm run verify:controller`：legacy 112/112、new 232 通过且 1 跳过、integration 202/202、workspace 5/5、project source 41/41、contracts 7/7、Dify manifest、build、lint 与全量 typecheck 全部通过
- Scope audit：9 个实现文件全部属于 core allowed modules 或 mechanical adjacent scope
- Prohibited audit：没有 index-group edit/upsert/PATCH、migration、新字段、新依赖、Task 6 executor/facts/admission、Web、Workflow YAML、认证或 Gate 变化
- 安全审查：Prompt 正文只进入 job config snapshot，不进入 API response、scope、event、outbox、step output reference 或日志；章节正文未进入 Task 5 snapshot 和可见投影
- 并发审查：group row lock 后查询 active concurrency key，真实 PostgreSQL 并发请求只产生一个 job、step 和 outbox
- `git diff --check`：通过

## Accepted Result

Task 5 实现符合 DEC-0008、DEC-0009 与 corrected contract，可创建 PR 并由 CI 核验

Task 6 在 Task 5 PR 合并并创建 merged checkpoint 前保持锁定，implementation baseline 保持 `820b30a1cfae0b0a19be9fa763f44801742d38e9`
