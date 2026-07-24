---
checkpoint_id: CP-20260724-PHASE5-TARGET-SERVER-ISOLATED-REHEARSAL-GATE-ACCEPTED
task_id: GATE-PHASE5-TARGET-SERVER-ISOLATED-REHEARSAL
status: accepted
recorded_at: 2026-07-24T08:40:27+08:00
branch: codex/phase5-rehearsal-accepted
base_commit: 491984d6fb26b40632e31d3e6a7dcf75ce60b0d3
head_commit: 491984d6fb26b40632e31d3e6a7dcf75ce60b0d3
supersedes: CP-20260724-PHASE5-TARGET-SERVER-ISOLATED-REHEARSAL-GATE-SUBMITTED
---

# Phase 5 Target-Server Isolated Rehearsal Gate Accepted

## Scope

接受`GATE-PHASE5-TARGET-SERVER-ISOLATED-REHEARSAL`，允许在批准的current controller Mac上按submitted boundary执行一次隔离迁移hard validation与capacity rehearsal

## Evidence

- [Submitted rehearsal Gate](CP-20260724-PHASE5-TARGET-SERVER-ISOLATED-REHEARSAL-GATE-SUBMITTED.md)
- [Production snapshot acquisition accepted](CP-20260723-PHASE5-PRODUCTION-SNAPSHOT-ACQUISITION-ACCEPTED.md)
- 用户于2026-07-24明确回复“A 接受gate”

## Target Decision

- Approved target为当前controller所在Mac
- 具体hostname、asset identity、private paths与server fingerprints只记录在private evidence，不进入Git
- Controller Agent为execution Owner，用户为Approver与hard-stop authority

## Accepted Boundary

- 允许在private preflight通过后临时请求和使用old production key file
- 允许生成两份独立ephemeral target keys
- 允许在隔离migration database上运行existing migration CLI与8项hard validation
- 允许在独立synthetic capacity database上使用controlled provider验证三个p95 thresholds与queue priority
- 所有命令、outputs、keys、logs、reports与cleanup必须遵守submitted Gate的private run、atomic evidence与bounded retention协议

## Still Locked

- 不得访问real Dify或修改Dify workflow、Prompt、Schema
- 不得修改Feishu callback、邀请代表用户或执行UAT
- 不得部署正式服务、创建正式数据库、开放正式流量或公网入口
- 不得执行traffic switch、cutover、停止旧服务或销毁旧备份
- Rehearsal database、snapshot、keys与artifacts不得晋升为正式环境

## Execution Status

本checkpoint只记录Gate接受与target decision，rehearsal尚未开始，old production key尚未请求

开始前必须fresh验证snapshot retention/fingerprint、target profile、network isolation、private run directory、migration seed state、capacity database isolation、key custody与cleanup ownership

任何preflight或hard stop失败时必须形成blocked checkpoint，不得降级、修改threshold或挑选其他run

## Next Gate

只有migration hard validation、capacity thresholds、secret scan与cleanup全部通过并形成accepted rehearsal result后，才可提交`GATE-PHASE5-FEISHU-UAT`

## Accepted Result

Target-server isolated rehearsal Gate已通过，current controller Mac被批准为target，execution尚未开始且所有later Gates保持locked
