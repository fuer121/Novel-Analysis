---
decision_id: DEC-0009
status: accepted
recorded_at: 2026-07-20T17:57:50+08:00
confidence: high
scope: phase-2-task5-workflow-snapshot-boundary
supersedes: none
---

# Phase 2 Task 5 Workflow Snapshot Boundary

## Context

Task 5 实施计划要求索引组绑定不可变 Prompt 与 Workflow 版本，但已批准设计只定义索引组绑定 Prompt，现有 `index_groups` 表也只有 `prompt_version_id` 与 `config_hash`，没有 `workflow_version_id`

仅把 Workflow ID 算入不可逆 hash 无法恢复和核验真实绑定，新增字段则需要扩大数据模型和 migration scope

## Decision

- 索引组创建时冻结不可变 Prompt 版本及 index-group config hash
- L2 job 创建时选择并冻结不可变 Workflow 版本到 job `config_snapshot`
- L2 scope hash 与 execution signature 必须包含实际 Workflow、Prompt、Schema、adapter contract、admission version、index-group config 和 L1 signature 输入
- Task 5 不新增 `index_groups.workflow_version_id` 或 migration

## Consequences

- 保持已批准数据模型和最小复杂度
- 索引组负责专项定义与 Prompt 绑定，job snapshot 负责一次执行的完整可重放配置
- Workflow 版本变化会改变 preview scope hash，旧 preview 在创建时返回 scope conflict

## Source

用户在总控指出计划与现有数据模型冲突后，于 2026-07-20 明确选择方案 B
