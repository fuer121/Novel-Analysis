---
decision_id: DEC-0026
status: accepted
recorded_at: 2026-07-25T14:45:00+08:00
confidence: high
scope: phase5-container-owned-ephemeral-storage
supersedes: DEC-0025
---

# Phase 5 Container Owned Ephemeral Storage

## Context

DEC-0025选择named volume composite identity，但独立质量审查复现了inspect与按name remove之间的TOCTOU

Docker volume没有可用于条件删除的immutable ID，任何inspect后按name删除都可能命中同名重建资源

Container具有immutable ID，并可通过按container ID执行`docker rm -v`清理其匿名volume

## Decision

- Migration与capacity PostgreSQL继续使用完全独立的container、network、credentials、loopback dynamic port与storage
- 不再创建或按name删除独立named volume
- PostgreSQL数据使用container-owned anonymous volume，volume生命周期由其owner container承载
- Create后首次inspect必须捕获并绑定container immutable `Id`、expected name、role、image digest、network attachment、loopback port、ownership labels与anonymous mount contract
- Cleanup只允许对已捕获并重新核验的immutable container ID执行`docker rm -v`
- Cleanup不得按container name或volume name删除资源
- Container ID不存在、身份不匹配、anonymous mount不完整或cleanup未完成时必须返回cleanup blocked并保留sanitized private claim
- Container删除后必须按immutable ID验证absence，并验证预期container与network name不存在
- 不尝试猜测或自动删除无法证明归属的orphan volume

## Quality Correction Contract

同一个V2 correction还必须关闭以下finding

- 对原始migration manifest、sidecar、provenance、report与final readback执行完整sentinel扫描，任何命中不得发布PASS
- Evidence成员与status写入后fsync，staging目录在rename前fsync，rename后parent目录fsync，PASS status及其parent在成功返回前fsync
- Partial-create、ownership mismatch或cleanup blocked时原子保留sanitized private BLOCKED evidence，包含run ID、role、kind、已捕获immutable ID与安全处置状态，不包含credential、URL、private path或敏感派生值

## Preserved Safety Boundary

- 保留DEC-0024的fixed PostgreSQL image digest、random run ID与credentials、separate migration/capacity resources、pre-create absence、post-create identity capture、cleanup-before-PASS与fresh absence
- 保留DEC-0025的container与network kind-specific inspect及absence parser
- Config不得提供resource name、credential、URL、port、command或cleanup target
- 本决策不授权访问Docker daemon、database、network、snapshot、key、Dify、飞书或real retry

## Consequences

- DEC-0025关于named volume composite identity与volume name cleanup的要求由本决策替代
- DEC-0025其余kind-specific Docker schema要求继续有效
- Candidate必须从当前blocked bytes重新修正、冻结并完成独立规格与质量审查
- 任何无法证明由captured container ID拥有的storage都不得自动删除

## Evidence

- [V1 quality blocked](../checkpoints/CP-20260725-PHASE5-IDENTITY-V3-V1-QUALITY-BLOCKED.md)
- 独立质量审查已在临时变异中复现inspect后同名重建volume被误删

## Source

用户于`2026-07-25`确认接受总控建议，放弃V1并按V2推进

## Accepted Result

接受container-owned anonymous storage与immutable container ID cleanup策略

只解锁synthetic correction与独立双审，真实执行与全部真实资源继续locked
