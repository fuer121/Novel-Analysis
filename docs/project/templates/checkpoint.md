---
checkpoint_id: CP-YYYYMMDD-TASK-ID
task_id: TASK-ID
status: submitted
recorded_at: YYYY-MM-DDTHH:MM:SS+08:00
branch: replace-with-task-branch
base_commit: 0000000000000000000000000000000000000000
head_commit: 0000000000000000000000000000000000000000
supersedes: none
---

# Checkpoint Submission Template

> **提交门禁：`checkpoint_id`、`task_id`、`recorded_at`、`branch`、`base_commit`、`head_commit` 等占位值必须全部替换后才能提交，模板永远不能自行成为 `accepted`**

本文件是状态为 `submitted` 的可复用提交模板，不代表结果已被接受

## Assigned Scope

- Core modules：待填写实际使用的核心模块范围
- Mechanical adjacent scope：待填写实际使用的机械性配套范围，无则填写无
- Required behavior：待填写必须实现并验证的行为

## Prohibited Changes Audit

待填写：逐项确认未发生禁止变更，或提供升级处理记录

## Actual Changes

待填写：列出实际变更的文件、行为和实现结果

## Verification By Role

| 角色 | 检查项 | 命令或证据 | 结果 |
| --- | --- | --- | --- |
| 实现 Agent | 待填写 | 待填写 | 待填写 |

## Scope Deviations

无报告：如有偏差，替换本行并说明偏差、原因和影响

## Escalations

无报告：如触发升级条件，替换本行并提供处理状态和可核验证据

## Risks And Blockers

无报告：如有其他风险或阻塞，替换本行并提供可核验证据

## User Feedback

无报告：如有用户反馈，替换本行并记录原意和核验状态

## Decisions Required

无报告：如需总控或用户决策，替换本行并列出具体问题

## Recommended Next Action

待填写：说明提交核验后的建议动作，不得假定已获接受

## Acceptance Request

请求总控 Agent 核验以上范围、变更和证据，并决定接受、拒绝或要求补充证据
