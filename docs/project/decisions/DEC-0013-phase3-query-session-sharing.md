---
decision_id: DEC-0013
status: accepted
recorded_at: 2026-07-21T00:23:56+08:00
confidence: high
scope: phase3-query-session-sharing
supersedes: none
---

# Phase 3 Query Session Sharing

## Context

共享书库不代表研究问题、回答与会话标题必须默认向团队公开

Phase 3 需要同时支持个人研究空间和团队协作，并保持会话设置、turn 操作与管理员权限边界明确

## Decision

- 新研究会话默认 `private`，只对创建人和管理员可见
- 会话创建人可以把整个会话切换为 `team`，不引入成员级 ACL
- 团队成员可查看共享会话并新增自己的 turn
- 团队成员只能取消或重试自己创建的 turn
- 只有会话创建人和管理员可以重命名、切换可见性或归档会话
- 管理员可以查看和管理全部会话与 turn

## Consequences

- Query API 必须在服务端按会话可见性、创建人和当前用户角色执行授权
- Query tests 必须覆盖私有读取拒绝、共享协作、会话设置权限和他人 turn 控制拒绝
- Phase 3 不实现单成员、成员组、链接或外部分享
- 会话标题、问题与回答仍按用户内容加密，分享不改变密文策略

## Source

用户于 2026-07-21 明确选择默认私有、主动团队分享，并确认共享成员可新增自己的 turn，只有创建人和管理员管理会话设置
