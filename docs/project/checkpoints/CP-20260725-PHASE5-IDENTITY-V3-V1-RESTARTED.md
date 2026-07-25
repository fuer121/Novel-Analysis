---
checkpoint_id: CP-20260725-PHASE5-IDENTITY-V3-V1-RESTARTED
task_id: PHASE5-REAL-RETRY-IDENTITY
status: accepted
recorded_at: 2026-07-25T14:08:18+08:00
branch: unassigned
base_commit: a2dc4250388787b517f29253728e34d2646fc33c
head_commit: a2dc4250388787b517f29253728e34d2646fc33c
supersedes: none
---

# Phase 5 Identity V3 V1 Restarted

## Scope

实施[DEC-0025 Docker Resource Kind Identities](../decisions/DEC-0025-phase5-docker-resource-kind-identities.md)，用kind-specific真实CLI schema修正volume identity与network absence

## Task Contract

- Task ID：`PHASE5-REAL-RETRY-IDENTITY`
- Core allowed modules：repository-external v3 draft、candidate与review evidence
- Mechanical adjacent scope：synthetic review runner、脱敏Docker CLI fixture、catalog与detached digest
- Base commit：`a2dc4250388787b517f29253728e34d2646fc33c`
- Required volume identity：精确绑定`Name`、`Driver`、`Scope`、`Mountpoint`、`CreatedAt`与ownership labels，不要求或接受`Id`
- Required kind separation：container、network、volume分别解析inspect identity与not-found error
- Required fixtures：fixture字段与错误形态必须匹配真实Docker CLI contract，不得发明字段
- Required cleanup：identity不完整或变化时不删除并返回cleanup blocked；匹配时按既有顺序cleanup并执行六名称fresh absence
- Required preservation：保持已关闭的manifest evidence、partial-create claim、bundle root、Git SHA、non-circular bootstrap、R1 lifecycle与review reproducibility
- Required verification：RED/GREEN volume no-Id、same-name recreated volume、network not-found、kind-crossing rejection、full synthetic success/failure、spec re-review与quality review
- Escalation：需要取消named volume、连接Docker daemon、改变R1 lifecycle、真实input或Gate

## Prohibited Changes

- 访问Docker daemon、database、network、snapshot、key、Dify或飞书
- 接受config resource name、credential、URL、port或command
- 在volume composite mismatch时删除resource
- 修改repository product code、migration、Schema、capacity或Gate

## Evidence

- 用户明确选择V1
- 当前candidate规格blocked且未进入quality review
- Review evidence仍保留，可在修正后独立复跑

## Accepted Result

解锁V1 synthetic correction、candidate重新冻结与独立双审

Execution confirmation与真实执行继续locked
