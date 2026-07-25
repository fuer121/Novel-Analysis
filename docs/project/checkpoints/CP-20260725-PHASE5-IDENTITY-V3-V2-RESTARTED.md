---
checkpoint_id: CP-20260725-PHASE5-IDENTITY-V3-V2-RESTARTED
task_id: PHASE5-REAL-RETRY-IDENTITY
status: accepted
recorded_at: 2026-07-25T14:45:00+08:00
branch: unassigned
base_commit: c29966d7a18a54ad84305b4ebb8c2e32a88c3c53
head_commit: c29966d7a18a54ad84305b4ebb8c2e32a88c3c53
supersedes: none
---

# Phase 5 Identity V3 V2 Restarted

## Scope

实施[DEC-0026 Container Owned Ephemeral Storage](../decisions/DEC-0026-phase5-container-owned-ephemeral-storage.md)，用immutable container ID关闭volume deletion TOCTOU，并在同一个correction中关闭V1质量审查的其余三个Important finding

## Task Contract

- Task ID：`PHASE5-REAL-RETRY-IDENTITY`
- Core allowed modules：repository-external v3 draft、candidate与review evidence
- Mechanical adjacent scope：synthetic runner、脱敏Docker CLI fixture、catalog、detached digest与sanitized result
- Base commit：`c29966d7a18a54ad84305b4ebb8c2e32a88c3c53`
- Required storage lifecycle：不创建named volume；每个PostgreSQL container拥有独立anonymous volume；cleanup只按captured immutable container ID执行`docker rm -v`
- Required ownership：绑定container ID、expected name、role、image digest、network attachment、loopback port、ownership labels与anonymous mount contract
- Required failure behavior：identity mismatch、container absence、mount不完整或cleanup未完成时不按name删除任何资源，并原子保留sanitized private BLOCKED evidence
- Required publication：manifest、sidecar、provenance、report与final readback全部通过sentinel扫描，evidence与status完成文件和目录fsync后才能发布PASS
- Required preservation：保持已关闭的manifest provenance、partial-create claim、bundle root、Git SHA、non-circular bootstrap、kind-specific parser与review reproducibility
- Required verification：RED/GREEN inspect-delete race、container ID cleanup、anonymous mount ownership、manifest sentinel injection、durable publication instrumentation、blocked evidence retention、full synthetic success/failure、spec review与quality review
- Escalation：需要named volume、按name删除、连接Docker daemon、改变R1 isolation、访问真实input或修改Gate

## Prohibited Changes

- 访问Docker daemon、database、network、snapshot、key、Dify或飞书
- 修改repository product code、migration、Schema、capacity或Gate
- 接受config resource name、credential、URL、port、command或cleanup target
- 按container name或volume name执行cleanup
- 在cleanup或durability未证明完成时发布PASS

## Evidence

- 用户确认切换到V2
- V1规格审查通过但质量审查存在四个Important finding
- 当前candidate保持blocked，旧candidate与review evidence继续保留

## Accepted Result

解锁V2 synthetic correction、candidate重新冻结与独立双审

Execution confirmation与真实执行继续locked
