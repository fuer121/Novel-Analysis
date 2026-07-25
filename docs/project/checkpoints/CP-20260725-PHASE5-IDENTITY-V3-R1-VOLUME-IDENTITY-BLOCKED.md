---
checkpoint_id: CP-20260725-PHASE5-IDENTITY-V3-R1-VOLUME-IDENTITY-BLOCKED
task_id: PHASE5-REAL-RETRY-IDENTITY
status: accepted
recorded_at: 2026-07-25T12:16:15+08:00
branch: codex/phase5-r1-volume-blocked
base_commit: ee74fc4ca32f929735fcae9ecd4664cc73e97494
head_commit: ee74fc4ca32f929735fcae9ecd4664cc73e97494
supersedes: none
---

# Phase 5 Identity V3 R1 Volume Identity Blocked

## Scope

记录R1 candidate关闭原规格2个Critical与3个Important后，因synthetic Docker volume与network fixture不符合真实CLI schema而继续blocked

本checkpoint不接受candidate、不授权Docker、database、真实input或real retry

## Evidence

- Candidate exact 8 files，当前目录`0700`、files `0600`、无symlink
- Candidate entry SHA为`e7d2ee6229c2e127400ed606c2abfab81a3311be875c4ac02157a96cc22958ea`
- Candidate catalog SHA为`26cb17356a56b4d8759e39164e8808b1a632a06f368f2ea81b510fef7469cab8`
- Candidate外review evidence保留，manifest与detached digest复算一致
- Fresh review runner 11/11通过
- 原manifest atomic evidence、partial-create claim、bundle root runtime validation、fixed Git SHA与review reproducibility findings已关闭
- 独立规格复审仍为`SPEC_BLOCKED`，存在2个Important
- 未访问Docker daemon、database、network、snapshot、key、Dify或飞书

## Blocking Findings

### Docker Volume Identity

Candidate parser要求container、network与volume inspect结果均包含`Id`

真实`docker volume inspect`对象没有`Id`字段，synthetic fixture人为加入了不存在的字段

因此真实volume首次inspect与cleanup ownership检查必然失败

### Docker Network Absence

Candidate对三类resource统一要求stderr包含`No such <kind>`

真实Docker network不存在时通常返回`network <name> not found`，现有synthetic fixture没有覆盖真实CLI契约

Network问题可在既有范围内使用kind-specific parser与脱敏fixture修复

Volume没有immutable `Id`，需要修订DEC-0024的volume identity策略

## Candidate Status

- 当前candidate继续invalid，不得进入quality review、Execution confirmation或real retry
- Review evidence继续保留至correction完成并通过独立双审
- 不得把11/11 synthetic通过视为真实Docker contract证据

## Decision Required

### Option V1

Named volume继续保留，volume identity改为Docker实际提供的composite attestation

Composite必须精确绑定`Name`、`Driver`、`Scope`、`Mountpoint`、`CreatedAt`与ownership label，cleanup前全部匹配，任一字段变化不得删除

### Option V2

取消独立named volume，使用container-owned ephemeral storage并通过container immutable ID统一管理与`rm -v`清理

总控推荐V1

V1保持DEC-0024的独立volume生命周期，只修正不存在的`Id`假设；`CreatedAt`与random ownership label可以识别delete-and-recreate，变化时fail closed

## Prohibited Changes Audit

- 未连接Docker daemon或读取真实Docker state
- 未创建、修改或删除container、volume、network或database
- 未访问production snapshot、old key、Keychain或真实credential
- 未修改repository product code、migration、Schema、capacity或Gate

## Accepted Result

接受R1 candidate因volume identity schema不成立而blocked

用户明确选择V1或V2前停止实现，真实执行继续locked

## Recommended Next Action

用户选择V1或V2后创建DEC-0024 correction，使用kind-specific真实CLI schema fixture完成修正与规格复审
