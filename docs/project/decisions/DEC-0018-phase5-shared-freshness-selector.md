---
decision_id: DEC-0018
status: accepted
recorded_at: 2026-07-23T13:15:58+08:00
confidence: high
scope: phase5-task4-freshness-ownership
supersedes: none
---

# Phase 5 Shared Freshness Selector Ownership

## Context

PHASE5-TASK4 quality review 证明 readiness 不能只读取 stored `status=fresh`，必须复用现有 L1/L2 canonical input signature semantics

authoritative selectors 当前私有于 jobs，而 jobs 已依赖 database；database 反向依赖 jobs 会形成循环。canonical signature builders 位于 domain，database 当前未声明 domain workspace dependency

## Decision

- 采用方案 A，允许新增 existing workspace dependency `@novel-analysis/database -> @novel-analysis/domain`
- 将 L1/L2 shared read-only canonical freshness selector 机械抽取到 database ownership
- jobs 与 rebuild readiness 必须调用同一 shared selector，不得保留两套 freshness 公式
- selector 必须保持现有 chapter source/HMAC、enabled workflow、Prompt、schema/admission version、group config 与 upstream L1 signature 语义
- 抽取前后 existing L1/L2 Job selection、skip/rebuild、lease、outbox、provider 与 persistence behavior 必须由 regression tests 证明完全不变
- Task 4 仍分别评估 current L1 与 L2 Job，任何 active relevant Job 均 fail closed，不得被另一类型 terminal Job 掩盖
- 本决策不允许新 table、migration、external dependency、Prompt/Dify 变化、freshness policy 变化或 scheduler

## Consequences

- database package 增加一个现有 workspace dependency 与 shared selector module/export
- jobs package 发生机械 wiring/refactor，属于 Task 4 correction scope，但不得产生用户可见语义变化
- Task 4 verification 扩大到 existing L1/L2 jobs focused regression、canonical signature drift matrix、database/API/Web 与 controller full verification
- 任何无法保持 existing jobs behavior 的情况必须再次停止，不得以 readiness 需求修改 canonical semantics

## Evidence

- [Task 4 blocker](../checkpoints/CP-20260723-PHASE5-TASK4-BLOCKED.md)
- 用户在了解 A/B 使用层面无差异与维护影响后明确选择“A”

## Source

用户于 2026-07-23 对 Task 4 dependency/ownership escalation 明确回复“A”
