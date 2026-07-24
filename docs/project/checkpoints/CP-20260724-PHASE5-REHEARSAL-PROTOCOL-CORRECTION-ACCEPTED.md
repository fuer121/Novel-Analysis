---
checkpoint_id: CP-20260724-PHASE5-REHEARSAL-PROTOCOL-CORRECTION-ACCEPTED
task_id: PHASE5-TARGET-SERVER-ISOLATED-REHEARSAL
status: accepted
recorded_at: 2026-07-24T10:04:00+08:00
branch: codex/phase5-rehearsal-protocol-accepted
base_commit: ae5a3a7ad8c21570f4ac47c7edeeee2a9bcc2ab4
head_commit: ae5a3a7ad8c21570f4ac47c7edeeee2a9bcc2ab4
supersedes: CP-20260724-PHASE5-REHEARSAL-PROTOCOL-CORRECTION-SUBMITTED
---

# Phase 5 Rehearsal Protocol Correction Accepted

## Scope

接受v2 private execution protocol，解锁一次全新target-server isolated rehearsal retry

## Evidence

- [Submitted v2 protocol correction](CP-20260724-PHASE5-REHEARSAL-PROTOCOL-CORRECTION-SUBMITTED.md)
- [Prior blocked run](CP-20260724-PHASE5-TARGET-SERVER-ISOLATED-REHEARSAL-BLOCKED.md)
- 用户于2026-07-24明确回复接受v2协议、允许CI通过后合并PR #159并继续推进
- PR #159 CI `verify`通过并已合并
- Independent spec review为`SPEC_COMPLIANT`
- Independent quality review为`QUALITY_APPROVED`

## Accepted Boundary

- Actual retry必须使用与accepted private v2 manifest逐byte匹配的parent launcher与protocol wrapper
- Parent launcher必须在Bash启动前创建并验证private `0600` process-level stdout与stderr sinks
- Actual target script、canonical invocation、Bash version、exit code、artifacts与hashes必须绑定到actual private run manifest
- 任一launcher或wrapper identity变化立即使本授权失效，必须重新synthetic dry run与确认
- Retry必须使用全新private run directory、全新ephemeral target keys与全新isolated databases
- 原accepted rehearsal Gate的migration scope、8项hard validation、capacity thresholds、hard stops、cleanup与retention规则保持不变

## Still Locked

- `GATE-PHASE5-FEISHU-UAT`
- Real Dify与workflow、Prompt或Schema变更
- Feishu callback、邀请代表用户与UAT
- 正式部署、正式数据库、正式流量与公网入口
- Traffic switch、cutover、停止旧服务或销毁旧备份

## Execution Status

本checkpoint只接受v2 protocol correction并解锁一次fresh retry

Production snapshot、old production key与actual rehearsal尚未在本次retry中访问或执行

## Accepted Result

V2 protocol correction已接受，一次全新target-server isolated rehearsal retry已解锁，所有later Gates保持locked
