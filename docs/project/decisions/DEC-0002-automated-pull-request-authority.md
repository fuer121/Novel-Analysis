---
decision_id: DEC-0002
status: accepted
recorded_at: 2026-07-18T22:05:00+08:00
confidence: high
scope: project-delivery-governance
supersedes: none
---

# Automated Pull Request Authority

## Decision

总控 Agent 可以自主创建、更新、审查并合并同时满足以下全部条件的 PR，无需逐次等待用户确认

1. PR 属于已经批准的阶段计划和 task contract
2. 改动未超出 allowed scope，且未触碰 prohibited changes
3. 所有 required verification、CI 和必要审查均通过
4. 不存在未解决的 Critical、Important 或阻塞性 finding
5. 不涉及范围扩张、架构变化、计划外的数据模型或安全策略变化
6. 不涉及阶段 Gate、验收标准、正式数据、部署切换或其他不可逆操作
7. 不覆盖用户修改，不存在无法确定的合并冲突

满足全部条件时，总控 Agent 可以自主完成以下动作

- 创建或更新 PR
- 等待并核验 CI
- 处理低风险审查反馈
- 将 Draft PR 转为 Ready
- 合并 PR
- 同步本地 `main`
- 创建 merged Checkpoint
- 更新项目唯一信源
- 解锁并推进下一个已批准任务

## Mandatory Stop Conditions

出现以下任一情况时，总控 Agent 必须停止并向用户确认

- 超出已批准范围
- 架构、数据、安全或权限策略发生变化
- 修改阶段 Gate 或验收标准
- CI、测试或审查未通过
- destructive migration、正式数据操作、部署或线上切换
- 存在用户改动冲突或其他不可逆风险

自动化授权不允许总控 Agent 降低 required verification、跳过必要审查、修改既定 Gate，或把一个 task contract 的权限扩张到另一个任务

## Source

本决策来源于用户在 2026-07-18 对总控 Agent 的明确项目级授权，自该授权发出时生效；后续 Agent 必须通过 `PROJECT.md` 和本 decision 获取权限边界，不得仅依赖线程上下文
