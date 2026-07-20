---
decision_id: DEC-0008
status: accepted
recorded_at: 2026-07-20T17:47:52+08:00
confidence: high
scope: phase-2-task5-index-group-api
supersedes: none
---

# Phase 2 Task 5 Index Group Create Only

## Context

Phase 2 Task 5 计划正文要求创建或编辑索引组，但列出的 API 只有 `POST /api/books/:bookId/index-groups`，没有编辑 endpoint

将 `POST` 隐式解释为 upsert 会引入不清晰的更新语义，新增 `PATCH` 又会扩大已列出的 API 范围

## Decision

- Task 5 的 `POST /api/books/:bookId/index-groups` 只创建索引组
- Task 5 不实现索引组编辑、upsert 或 `PATCH` endpoint
- 索引组编辑能力延期，不阻塞 Task 5 验收
- 后续如需编辑能力，必须重新定义 API、版本绑定和失效传播契约

## Consequences

- Task 5 保持最小 API 范围和明确的创建语义
- 重复 book/key 由既有唯一约束拒绝，不静默修改已存在索引组
- Prompt 与 Workflow 版本绑定在创建时冻结

## Source

用户在总控指出计划文本与 API 清单冲突后，于 2026-07-20 明确选择方案 A
