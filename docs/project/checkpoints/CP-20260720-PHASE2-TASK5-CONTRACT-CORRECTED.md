---
checkpoint_id: CP-20260720-PHASE2-TASK5-CONTRACT-CORRECTED
task_id: PHASE2-TASK5
status: accepted
recorded_at: 2026-07-20T17:57:50+08:00
branch: codex/phase2-task5-l2-scope
base_commit: 553c803dbd7ce2dd18930c08b770832433e92355
head_commit: 553c803dbd7ce2dd18930c08b770832433e92355
supersedes: CP-20260720-GOV-MECHANISMS-MERGED-PHASE2-TASK5-STARTED
---

# Phase 2 Task 5 Contract Corrected

## Scope

修正 Task 5 Started Contract 中索引组与 L2 job 的不可变版本绑定边界

本 correction 只替换以下要求：索引组创建时冻结 Prompt 版本与 index-group config hash，Workflow 版本在 L2 job 创建时冻结到 `config_snapshot`

原 Started Contract 的 core allowed modules、mechanical adjacent scope、create-only API、scope matrix、事务、幂等、并发、验证、禁止项、升级条件和资源预算继续有效

## Evidence

- 已批准设计将 `index_groups` 定义为 L2 专项定义、范围、Prompt 绑定和状态
- `index_groups` 现有 schema 包含 `prompt_version_id` 与 `config_hash`，不包含 `workflow_version_id`
- 不可逆 config hash 无法替代可恢复、可核验的 Workflow 版本引用
- 用户明确选择 job snapshot 冻结 Workflow 的方案 B
- correction 未授权 migration、新字段或扩大 API

## Accepted Result

Task 5 按 DEC-0009 继续实施，不新增 migration；preview 与 creation 必须对实际 Workflow 版本变化 fail closed

本 correction 不接受 Task 5 实现结果，不更新 implementation baseline，也不提前解锁 Task 6
