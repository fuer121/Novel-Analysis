---
checkpoint_id: CP-20260723-PHASE5-TASK4-BLOCKED
task_id: PHASE5-TASK4
status: accepted
recorded_at: 2026-07-23T13:05:14+08:00
branch: codex/phase5-task4
base_commit: c9d5663297c5c636d55385330068dfce5d718689
head_commit: 959bc28ad72c59ba0216402e8f1170617bce23f9
supersedes: none
---

# Phase 5 Task 4 Blocked

## Scope

记录 PHASE5-TASK4 在 quality review 后触发的 dependency/ownership escalation，不接受当前实现，不解锁 Task 5

## Evidence

- implementation head `ccdb9dcb146d25ab7b6d911f38ed6348f9d457e2` 完成 contracts、existing-table readiness、API locks 与 Web disabled state
- specification correction head `959bc28ad72c59ba0216402e8f1170617bce23f9` 修复 retained coverage 下 active/failed Job precedence 与 Web pending/error fail-closed
- 最终 specification review 为 `SPEC_COMPLIANT`
- quality review 拒绝实现：readiness 只信任 stored `status=fresh`，没有复用 existing L1/L2 canonical input signature semantics；单一 latest Job 也可能让另一类型 active Job 被 terminal Job 掩盖
- authoritative L1/L2 selectors 当前私有于 `@novel-analysis/jobs`，而 jobs 已依赖 database，因此 database import jobs 会形成 dependency cycle
- canonical signature builders 位于 `@novel-analysis/domain`，database 当前没有 domain dependency
- 实现 Agent 在发现边界后停止，没有复制简化 freshness 公式，也没有继续修改 production/test files

## Blocker

在不改变当前 dependency/ownership boundary 的前提下，database readiness 无法 single-source 复用 canonical L1/L2 freshness semantics

继续需要用户明确批准以下一种架构边界变化：

- 方案 A：增加 existing workspace dependency `database -> domain`，把 shared read-only canonical freshness selector 机械抽取到 database，jobs 与 readiness 共用
- 方案 B：将 readiness ownership 从 database 移到已有 jobs/service boundary，直接复用 canonical selector，再由 API 注入该 read service

## Accepted Result

PHASE5-TASK4 状态为 blocked，等待用户对 dependency/ownership boundary 做明确决策

本 checkpoint 不接受 Task 4 implementation，不修改 Phase 5 Gate，不授权新 table、migration、scheduler、Prompt/Dify、正式 rebuild、数据、部署或切换

## Recommended Next Action

总控建议方案 A：变化较窄，保留 readiness 作为 database read model，通过既有 domain signature builders 与 shared selector 消除重复公式；实施必须证明 jobs behavior 完全不变并扩大 Job/freshness regression verification
