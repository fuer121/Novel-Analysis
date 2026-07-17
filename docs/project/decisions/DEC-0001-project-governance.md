---
decision_id: DEC-0001
status: accepted
recorded_at: 2026-07-17T17:00:00+08:00
confidence: high
scope: project-governance
supersedes: none
---

# Controller-Owned Project Source

## Decision

项目采用总控 Agent 单写的唯一信源，总控 Agent 负责核验并更新项目状态，执行 Agent 和审查 Agent 只提交证据与反馈，不直接修改已确认状态

## Authority

不同事实类型分别按以下权威顺序处理

- 产品方向：用户明确确认 > PROJECT 当前决策 > accepted decision/spec
- 当前实现：代码与自动化测试 > accepted checkpoint/handoff > 说明文档
- Git/交付：远端 Git/PR/CI > 本地分支 > Agent 自述
- Dify：用户确认的最新线上导出 YAML + manifest > 适配代码推断 > 历史文档
- 数据迁移：迁移审计 > 数据库快照 > 计划估算

只有总控 Agent 可以将核验结果写入唯一信源，执行 Agent 和审查 Agent 只能提交证据供总控核验

## Conflict Handling

任何来源冲突都必须阻塞推进，总控 Agent 应将基线标记为 `conflicted` 或 `blocked`，保留相互冲突的证据并等待核验或用户裁决

## Source

本决策来源于用户在 2026-07-17 对项目治理规则的逐项确认
