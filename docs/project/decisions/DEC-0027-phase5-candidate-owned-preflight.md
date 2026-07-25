---
decision_id: DEC-0027
status: accepted
recorded_at: 2026-07-25T17:30:00+08:00
confidence: high
scope: phase5-candidate-owned-preflight
supersedes: none
---

# Phase 5 Candidate-Owned Preflight

## Context

Execution V2因controller临时stage checker使用默认buffer发生`ENOBUFS`误判，且controller在identity与stage验证前访问snapshot metadata、fingerprint与integrity而blocked

Accepted candidate自身已使用8 MiB bounded buffer且anchor与stage实际匹配，因此修正应移除controller重复checker并把完整顺序收回同一candidate

## Decision

Real retry的identity、tool、repository anchor与stage byte验证必须由同一accepted candidate提供正式preflight模式，controller不得在candidate调用前增加临时checker或重复实现stage验证

Preflight不得要求config、snapshot或key输入，且必须在任何snapshot metadata、fingerprint、integrity、old key、target key或Keychain访问前完成

Snapshot deadline、metadata、fingerprint、integrity与custody validation必须进入candidate bytes，并在full execution内先重新验证identity、tool、repository与stage，再读取snapshot，且snapshot验证完成前不得读取任何key

## Required Evidence

- Preflight invocation无需config或sensitive input即可验证exact bundle、tools、repository anchor与large stage object
- Large stage object验证使用明确bounded buffer并覆盖默认buffer `ENOBUFS` regression
- Synthetic ordering assertion证明identity或stage失败时snapshot与key均未访问
- Synthetic ordering assertion证明snapshot validation失败时key未访问
- Full execution重新验证identity与stage，不依赖先前preflight结果
- Wrapper、bootstrap、entry、必要helper、catalog与digest作为单一冻结identity完成双审

## Locked Scope

本decision不授权production snapshot、old key、Keychain、Docker、PostgreSQL、Dify、飞书、UAT、deployment、traffic switch、cutover或任何真实retry

本decision不修改migration语义、database schema、capacity threshold、Gate顺序或验收标准

## Source

用户于`2026-07-25`明确选择方案A，接受candidate-owned preflight与snapshot validation ordering修正

## Accepted Result

解锁repository-external synthetic correction、candidate重新冻结与独立双审

全部真实资源、真实retry与后续环境Gate继续locked
