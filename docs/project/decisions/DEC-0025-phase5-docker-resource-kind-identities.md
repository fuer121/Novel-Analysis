---
decision_id: DEC-0025
status: accepted
recorded_at: 2026-07-25T14:08:18+08:00
confidence: high
scope: phase5-docker-resource-kind-identity
supersedes: DEC-0024
---

# Phase 5 Docker Resource Kind Identities

## Context

DEC-0024要求container、network与volume均绑定Docker immutable resource ID

独立规格审查确认真实`docker volume inspect`没有`Id`字段，synthetic fixture错误地为volume构造了不存在的字段

Docker三类resource的identity与absence error schema不同，不能使用统一parser

## Decision

- 保留DEC-0024的launcher-owned PostgreSQL lifecycle、独立named volume与全部credential、port、naming、URL、cleanup与Gate边界
- Container identity绑定`Id`、`Name`、role与ownership labels
- Network identity绑定`Id`、`Name`、Driver、Scope、Internal与ownership labels
- Volume identity使用composite attestation，绑定`Name`、`Driver`、`Scope`、`Mountpoint`、`CreatedAt`与ownership labels
- Volume cleanup前必须逐字段匹配创建后首次inspect保存的composite，任一字段缺失或变化不得删除
- `CreatedAt`与random ownership label用于识别同名volume被删除后重建
- Container、network与volume分别实现inspect parser与absence parser
- Synthetic fixture必须使用脱敏的真实Docker CLI字段结构与kind-specific not-found error形态
- Parser不得接受不存在的volume `Id`，也不得把一种resource的not-found text套用于其他kind

## Preserved Safety Boundary

- Resource name仍由fixed prefix、run ID与role构造，config不得覆盖
- Create前absence、create后identity capture、cleanup前reinspect与cleanup后fresh absence保持不变
- Ownership mismatch或inspect不完整时不得删除，必须返回cleanup blocked且不得发布PASS
- Migration与capacity的container、volume与network继续完全独立
- 本决策不授权访问Docker daemon、database、真实input或real retry

## Consequences

- DEC-0024关于volume immutable `Id`的要求由本决策替代
- DEC-0024其余launcher-owned lifecycle策略继续有效
- Candidate必须重新冻结并完成独立规格与质量审查

## Evidence

- [R1 volume identity blocked](../checkpoints/CP-20260725-PHASE5-IDENTITY-V3-R1-VOLUME-IDENTITY-BLOCKED.md)
- Docker volume schema finding来自独立规格审查

## Source

用户于`2026-07-25`明确选择Option `V1`

## Accepted Result

接受kind-specific Docker resource identity与named-volume composite attestation

只解锁synthetic fixture correction与双审，真实Docker、database和real retry继续locked
