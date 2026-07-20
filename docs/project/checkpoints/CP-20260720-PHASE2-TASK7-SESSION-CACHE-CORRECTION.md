---
checkpoint_id: CP-20260720-PHASE2-TASK7-SESSION-CACHE-CORRECTION
task_id: PHASE2-TASK7
status: accepted
recorded_at: 2026-07-20T21:10:42+08:00
branch: codex/phase2-task7-book-workspace
base_commit: 06b2cdd301b5abdc0375b22b66950a890c11a1c7
head_commit: 06b2cdd301b5abdc0375b22b66950a890c11a1c7
supersedes: CP-20260720-PHASE2-TASK7-CONTRACT-CORRECTION
---

# Phase 2 Task 7 Session Cache Correction

## Scope

在 Task 7 已批准范围上增加以下最小客户端安全修复

- 会话失效时清除上一会话的 QueryClient 查询缓存
- 直接覆盖事实正文不跨会话残留的 Web 回归测试

## Required Behavior

- 事实正文不得在会话失效后留在共享查询缓存
- 后续登录不得继承上一用户的书籍、覆盖率、索引组或事实查询结果
- 登录跳转与重新认证继续使用既有服务端认证流程

## Prohibited Changes

- 服务端认证、授权、session、CSRF、凭证或权限策略
- API、schema、migration、外部依赖或持久化策略
- Phase 3 能力或 Phase 2 Gate

## Required Verification

- Web 回归测试证明会话失效后事实正文不再存在于 QueryClient
- 原 Task 7 Web、浏览器、质量和 controller verification

## Evidence

- Task 7 质量审查复现会话失效后事实正文仍存在于共享 QueryClient
- 原 Task 7 contract 将 session 行为列为 prohibited change，因此总控在实施前暂停并请求确认
- 用户于 2026-07-20 明确授权最小客户端缓存清理方案
- DEC-0012 将授权限制为 Web 查询缓存生命周期，不改变服务端认证与权限策略

## Accepted Result

Task 7 可按 DEC-0012 实施最小客户端会话缓存边界修复

本 checkpoint 不接受 Task 7 实现、不解锁 Task 8，也不修改 Phase 2 Gate
