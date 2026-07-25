---
decision_id: DEC-0028
status: accepted
recorded_at: 2026-07-25T20:40:35+08:00
confidence: high
scope: phase5-snapshot-preflight-mode
supersedes: none
---

# Phase 5 Snapshot Preflight Mode

## Context

Execution V3 config已经冻结，但full execute要求controller在process启动前准备old key、target keys与plaintext sentinel

这会使完整执行单元先准备keys，再由candidate验证snapshot，违反snapshot validation必须先于old-key access与target-key generation的既有安全顺序

## Decision

在accepted candidate的新副本中增加显式`snapshot-preflight`模式

该模式必须由candidate自身验证exact bundle、tools、repository anchor、large stage bytes、config SHA、snapshot deadline、metadata、fingerprint、sidecars、SQLite integrity与custody

该模式不得要求、创建、打开或访问old key、target encryption key、target HMAC key或plaintext sentinel，不得创建runtime、evidence、database、container、volume或network资源，并保持ordinary stdout与stderr为零

只有`snapshot-preflight`通过后controller才可另行准备keys

Full execute仍必须重新验证identity、tools、repository、stage与snapshot，不得把独立snapshot preflight结果当作执行期豁免凭证

## Required Evidence

- 全部key文件缺失时snapshot preflight成功
- Config、SHA、repository、stage或snapshot任一验证失败时均未访问key
- Snapshot preflight成功与失败均不创建runtime、evidence、database或Docker资源
- Bootstrap ordinary stdout与stderr保持零
- Full execute继续重新验证全部identity与snapshot后才消费keys
- Complete synthetic suite、leakage scan、cleanup audit与独立规格和质量审查通过
- 最终launcher、wrapper、entry、必要helper、catalog与digest重新冻结并记录SHA-256

## Locked Scope

本decision不授权production snapshot bytes、old key、Keychain、target key generation、Docker、PostgreSQL、Dify、飞书、UAT、deployment、traffic switch、cutover或任何真实retry

本decision不修改migration语义、database schema、capacity threshold、Gate顺序或验收标准

## Source

用户于`2026-07-25`明确选择Execution V3 preparation blocked checkpoint中的Option A

## Accepted Result

解锁repository-external synthetic snapshot-preflight correction、candidate重新冻结与独立审查

全部真实资源、真实retry与后续环境Gate继续locked
