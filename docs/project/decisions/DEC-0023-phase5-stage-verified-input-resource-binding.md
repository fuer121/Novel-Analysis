---
decision_id: DEC-0023
status: accepted
recorded_at: 2026-07-25T08:40:56+08:00
confidence: high
scope: phase5-rehearsal-stage-input-and-resource-interface
supersedes: none
---

# Phase 5 Stage Verified Input And Resource Binding

## Context

Identity v2在freeze前确认accepted stage仍以path check后重新open方式消费request、database URL、migration source与key，并且request/result没有绑定launcher提供的migration与capacity resource ID

这使launcher即使验证了descriptor identity，也无法证明stage消费的是相同bytes，或证明stage实际操作的资源与launcher执行absence及cleanup检查的资源一致

## Decision

- 采用blocked checkpoint中的Option A1
- 保持现有Gate安全强度，不放宽same-descriptor verified-use或resource-match要求
- Sensitive request与input必须通过inherited descriptor或launcher已验证bytes交给stage
- Stage不得在验证path后以独立open重新读取同一敏感input
- 如果SQLite reader必须使用path，stage只可在自身trusted custody中从verified bytes创建private、write-once、一次性working copy，并在使用结束后清理
- Migration与capacity request必须携带launcher生成的opaque resource ID，result必须原样绑定对应ID
- Resource ID不得包含或派生自database URL、key、credential、snapshot fingerprint、private path或其他secret
- Stage artifact变更后必须重新构建、固定新SHA-256并完成独立规格与质量审查

## Preserved Contracts

- Migration选择、事务、Schema与8项hard validation语义不变
- Capacity dataset、browse `<500ms`、submit `<1000ms`、status `<2000ms`与两项priority assertion不变
- 单一committed Node ESM artifact及runtime closure要求不变
- Real retry两次明确确认、Gate顺序与验收标准不变

## Scope Boundary

- Core modules：`scripts/phase5-rehearsal-stage/**`
- Mechanical adjacent scope：最小migration verified-input入口、直接测试、root package scripts、artifact build与SHA checker
- 不新增dependency、table、migration、Schema、API、认证或权限语义
- 不读取production snapshot、old key、Keychain，不创建真实database，不访问Docker、Dify、飞书、deployment或cutover环境

## Consequences

- 旧artifact SHA `6ea6bebe5cdfee41f9060a270e1a3af8773fc51a8692d097af0900a31d4666f0`在接口修正后不再可用于新的identity candidate
- 新artifact通过双审前，identity v2继续blocked
- 本决策只解锁synthetic input下的接口实现与验证，不构成Execution confirmation

## Evidence

- [Identity v2 interface blocked](../checkpoints/CP-20260725-PHASE5-REAL-RETRY-IDENTITY-V2-INTERFACE-BLOCKED.md)
- 用户于`2026-07-25`明确选择Option `A1`

## Source

用户于`2026-07-25`明确回复`A1`，接受保持Gate安全强度并修正stage interface

## Accepted Result

接受A1 stage interface correction，保持现有Gate安全边界

只解锁无真实输入的实现、artifact重建与独立双审
