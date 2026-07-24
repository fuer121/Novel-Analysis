---
checkpoint_id: CP-20260724-PHASE5-V3-RETRY-CORRECTION-ACCEPTED
task_id: PHASE5-TARGET-SERVER-ISOLATED-REHEARSAL
status: accepted
recorded_at: 2026-07-24T12:27:59+08:00
branch: codex/phase5-v3-correction-accepted
base_commit: f07588c00124739ffe8cebf4e577c19f371bf59c
head_commit: f07588c00124739ffe8cebf4e577c19f371bf59c
supersedes: CP-20260724-PHASE5-V3-RETRY-CORRECTION-SUBMITTED
---

# Phase 5 V3 Retry Correction Accepted

## Scope

接受v3 private execution protocol与identity custody修正，只解锁一次fresh target-server isolated rehearsal retry

本checkpoint不执行pre-run、不访问production snapshot或old production key，也不启动actual retry

## Evidence

- [Submitted v3 correction](CP-20260724-PHASE5-V3-RETRY-CORRECTION-SUBMITTED.md)
- 用户于2026-07-24明确接受v3协议、允许合并PR #162并授权一次fresh isolated rehearsal retry
- PR #162已合并
- PR #162 CI passed
- Independent specification review为`APPROVED`
- Independent quality review为`QUALITY_APPROVED`

## Accepted Git Trust Anchor

Accepted `identity.json` SHA-256为`db4265cb9932da4b4189afeb54343eb82001609dae5b2118c9f81d6e69bc72ec`

Authorized pre-run只能从本accepted Git checkpoint读取该anchor，并必须按以下顺序执行

1. 以`O_NOFOLLOW`打开retained `identity.json`并对opened bytes计算SHA-256，必须与本anchor逐字一致
2. 只从已anchored manifest导出launcher、wrapper与helper script digests
3. 以anchored script digests验证opened script bytes
4. 只把已验证的exact bytes交给content-addressed verified launch handoff

Git anchor、opened manifest或任一script digest发生mismatch时，必须在创建process sinks、child launch或使用snapshot/key runtime inputs前以exit `70` hard-stop

Bundle内detached manifest hash只用于传输一致性检查，不是独立trust root

## Accepted Retry Boundary

- 只授权一次fresh isolated rehearsal retry，不得复用任何prior run directory、database、ephemeral key或working artifact
- Verified launch完成后必须立即销毁retained identity bundle及全部copies并验证不存在
- Identity bundle cleanup必须发生在production snapshot copy与old-key access前
- Retry继续执行原accepted Gate的8项hard validations、capacity thresholds、hard stops、cleanup与retention规则
- 任一identity byte变化、trust mismatch、cleanup failure或evidence conflict均立即消耗并停止本次retry，不得自动重跑

## Still Locked

- `GATE-PHASE5-FEISHU-UAT`
- Real Dify与workflow、Prompt或Schema变更
- Feishu callback、邀请代表用户与UAT
- 正式部署、正式数据库、正式流量与公网入口
- Traffic switch、cutover、停止旧服务或销毁旧备份

## Execution Status

V3 correction已接受，一次fresh isolated rehearsal retry已授权但尚未开始

Pre-run trust verification、identity cleanup、production snapshot access、old-key access、migration rehearsal、8项hard validations与capacity suite均为`NOT RUN`

## Accepted Result

V3 protocol correction与Git trust anchor已接受，只解锁一次受上述边界约束的fresh retry，所有later Gates保持locked
