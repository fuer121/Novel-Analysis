---
checkpoint_id: CP-20260724-PHASE5-TARGET-SERVER-ISOLATED-REHEARSAL-BLOCKED
task_id: PHASE5-TARGET-SERVER-ISOLATED-REHEARSAL
status: accepted
recorded_at: 2026-07-24T09:01:00+08:00
branch: codex/phase5-rehearsal-blocked
base_commit: 2f1c81ffc79870cd5b927ba0bfb895373cd38954
head_commit: 2f1c81ffc79870cd5b927ba0bfb895373cd38954
supersedes: none
---

# Phase 5 Target-Server Isolated Rehearsal Blocked

## Scope

记录已批准target上的隔离演练在private execution preflight后、migration CLI与capacity suite执行前触发hard stop

## Evidence

- [Accepted rehearsal Gate](CP-20260724-PHASE5-TARGET-SERVER-ISOLATED-REHEARSAL-GATE-ACCEPTED.md)
- Controller fresh verification确认repository clean、old application存活且无遗留rehearsal container
- Controller fresh cleanup verification确认两次cancelled run directory及其全部files、logs、scripts与working copies均不存在
- Private values未进入本checkpoint或`PROJECT.md`

## Result

- `status`: `BLOCKED`
- Production snapshot retention、fingerprint、integrity与private working copy检查通过
- 三份ephemeral key均完成exact length、private mode、non-symlink与distinctness检查
- Repository commit与clean状态检查通过
- Migration CLI未执行
- 8项migration hard validation未执行
- Capacity suite未执行
- Real Dify、Feishu、UAT、部署、流量与cutover均未触碰

## Blocking Finding

一次性PostgreSQL readiness轮询使用shell noclobber时重复创建同一stderr文件，shell将private run path写入普通controller terminal output

这违反accepted Gate中private path不得进入普通terminal、session log或ordinary artifact的hard-stop边界，因此本次run整体无效，不得继续、降级或作为后续Gate证据

该finding属于execution protocol缺陷，不是snapshot integrity、migration semantics、capacity threshold或production data failure

## Cleanup Evidence

- Old production key working file已销毁
- Ephemeral target encryption key已销毁
- Ephemeral target HMAC key已销毁
- Production snapshot working copy已销毁
- 一次性PostgreSQL container与其逻辑数据库已销毁
- 两次cancelled run的private logs、scripts、diagnostic artifacts与全部working copies已销毁
- Cancellation于2026-07-24T09:00:30+08:00生效，该时间是本次run evidence的最早retention deadline
- 本次run的private evidence retention为zero，不存在待到期销毁的副本
- Controller Agent为本次run唯一cleanup Owner，销毁后不再保有run directory access
- Canonical snapshot不属于本次run evidence，仍由原snapshot custodian按既有retention deadline保管
- Old application process保持运行
- Canonical retained snapshot未修改

## Verification

- Sensitive working artifacts absence: `PASS`
- Isolated container absence: `PASS`
- Old application process liveness: `PASS`
- Repository working tree remained clean: `PASS`

## Required Correction Before Retry

- readiness probe必须使用预先创建且可追加的private log，或每次使用独立private path
- 所有private command wrapper必须在执行前通过synthetic dry run验证noclobber、redirection与path disclosure行为
- Retry必须创建全新private run directory与全新ephemeral keys
- Retry不得复用本次run的migration、capacity或result evidence
- 修正后的execution protocol及synthetic dry-run evidence必须重新提交确认，不能依据原Gate自动重跑

## Gate Impact

`GATE-PHASE5-FEISHU-UAT`保持locked

本checkpoint不修改migration semantics、database schema、capacity thresholds或accepted Gate标准

## Accepted Result

总控接受本次execution outcome为`BLOCKED`，确认本次run无可用migration或capacity evidence、清理义务已完成，且修正协议重新确认前不得retry
