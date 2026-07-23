---
checkpoint_id: CP-20260723-PHASE5-TASK5-STARTED
task_id: PHASE5-TASK5
status: accepted
recorded_at: 2026-07-23T14:11:32+08:00
branch: codex/phase5-task5-started
base_commit: 61ec7ad70815f818ac69d66d8763e3c239e8fdf8
head_commit: 61ec7ad70815f818ac69d66d8763e3c239e8fdf8
supersedes: none
---

# Phase 5 Task 5 Started

## Scope

解锁 repository-owned indexing baseline、existing Job/Step/lease/outbox kernel上的persistent library rebuild batch、admin API/queue UI与synthetic recovery harness

## Task Contract

- Task ID：`PHASE5-TASK5`
- Core allowed modules：`config/indexing-baseline.json`与checker、existing contracts/jobs/step-leases/outbox、rebuild Worker executor、admin rebuild routes、library queue UI、Phase 5 recovery harness
- Mechanical adjacent scope：direct exports/types/tests、controlled fake Dify、root commands、Vitest config与existing runtime wiring
- Base commit：`61ec7ad70815f818ac69d66d8763e3c239e8fdf8`
- Required baseline：Prompt text/version、adapter contract、base group与L1/L2 DSL hashes必须逐字等于批准计划及`dify-workflows/manifest.json`；strict checker拒绝unknown field/hash/category drift，seeding幂等且不导入legacy Prompt
- Required batch：新增既有Job type `library-rebuild`，active concurrency key唯一为`library-rebuild:all`；每本书一个Step，默认按`books.updated_at DESC, books.id`排序
- Required reorder：仅接受完整ordered set、`queued`且`attempt_count=0`的Steps；同一transaction锁parent/Steps、negative temporary positions后写positive positions与单一audit；任一started/遗漏/重复Step fail closed
- Required recovery：Step output_ref持久保存stage与child IDs；defer在同一transaction验证lease/attempt authority、完成attempt、Step回queued并clear lease、更新nonsecret output_ref、写deduplicated delayed outbox wake；stale/late attempt零副作用
- Required idempotency：Worker kill、lease expiry、parent/child wake replay后每个stage最多一个active L1与一个active L2 child，恢复必须复用stored child ID
- Required execution：waiting→L1→L2→verify；child creation只调用existing services与approved baseline，base group幂等；verify只依赖canonical readiness
- Required access/UI：admin-only create/get/reorder，member拒绝；queue显示stage/progress/failure，只允许移动untouched waiting books，不提供readiness bypass
- Required verification：baseline checker、contracts、jobs/lease/worker/API/Web focused tests、synthetic PostgreSQL/fake Dify recovery E2E、Phase 2/3/4 E2E regression、lint、typecheck、diff/no-migration/scope、独立spec与quality review、controller full verify与CI
- Escalation：需要新table/migration；批准baseline与manifest/现有semantics不一致；transaction/lease/outbox evidence失败；必须重排started Step；需要改变L1/L2算法/DSL、provider quota、auth policy、架构/Gate；或需要真实Dify/数据/部署

## Prohibited Changes

新table/migration、legacy Prompt/index import、L1/L2算法或DSL变化、provider quota变化、started Step重排、正式Dify调用/书库重建、真实数据/凭证、Feishu、UAT、部署与切换

## Evidence

- Phase 5 Tasks 1-4已合并，Task 4 canonical readiness可供verify stage使用
- Phase 5 approved plan明确选择existing Job/Step/lease/outbox，不新增business table
- 用户要求继续按Subagent-Driven推进

## Accepted Result

Task 5可在本checkpoint合并后的main创建唯一实现worktree并派发fresh implementer；Task 6与所有正式操作未解锁
