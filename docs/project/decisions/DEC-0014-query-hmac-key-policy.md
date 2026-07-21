---
decision_id: DEC-0014
status: accepted
recorded_at: 2026-07-21T12:49:09+08:00
confidence: high
scope: query-credential-security
supersedes: none
---

# Query HMAC Key Policy

## Context

Query preview、幂等 fingerprint 和最近问题上下文使用 keyed HMAC 隔离问题与会话标题，弱密钥或复用内容加密密钥会削弱明文隔离与密钥域边界

Task 4 质量审查发现既有非空校验仍允许一字节密钥，且无法阻止运行时复用内容加密密钥，因此按项目安全策略变化边界暂停并请求用户确认

## Decision

- `CONTENT_HMAC_KEY` 必须显式配置为 canonical base64
- 解码后必须恰好为 32 字节随机密钥
- Query API 生产 composition 必须拒绝与 `CONTENT_ENCRYPTION_KEY` 字节相同的值
- `QueryJobService` 构造边界独立拒绝非 32 字节 HMAC key
- 配置错误只暴露稳定错误，不得包含 key、base64、hex 或派生值
- 本决策不修改 Worker、数据库 schema、凭证文件或部署环境

## Consequences

- 所有运行 Query API 的环境必须在启动前提供独立的 32 字节 `CONTENT_HMAC_KEY`
- 缺失、非 canonical base64、长度错误或与内容加密密钥相同会使 API fail closed
- 真实密钥生成、分发、轮换与部署不在 Task 4 范围内，执行时仍需遵循正式凭证与部署确认边界
- 直接构造 `QueryJobService` 的测试和非生产 composition 必须提供 32 字节 key，并自行保持与内容加密密钥独立

## Source

用户于 2026-07-21 在 Task 4 安全确认中明确选择方案 A：要求独立的 32 字节随机 HMAC key，并拒绝与内容加密 key 相同
