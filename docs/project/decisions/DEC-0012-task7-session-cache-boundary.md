---
decision_id: DEC-0012
status: accepted
recorded_at: 2026-07-20T21:10:42+08:00
confidence: high
scope: phase2-task7-session-cache-boundary
supersedes: none
---

# Task 7 Session Cache Boundary

## Context

Task 7 的事实审阅会把已解密事实正文保存在 Web QueryClient 中

质量审查确认，会话失效后现有实现只清除当前用户查询，上一会话的事实正文仍可能被同一 SPA 中后续登录的用户读取

## Decision

- 会话失效时清除上一会话的全部查询缓存，再跳转登录页
- 身份完成重新认证时不得复用上一会话查询缓存
- 保持事实正文只存在于当前授权会话的 QueryClient 中
- 只修改 Web 客户端缓存生命周期及其直接回归测试

## Consequences

- 不修改服务端认证、授权、session、CSRF、凭证或权限策略
- 不新增 API、数据对象、依赖或持久化明文
- Task 7 质量审查必须验证事实正文不会跨会话残留

## Source

用户于 2026-07-20 在总控报告该 session/security 契约边界后明确授权最小缓存清理方案
