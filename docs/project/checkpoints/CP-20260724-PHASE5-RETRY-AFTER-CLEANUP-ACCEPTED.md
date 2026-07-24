---
checkpoint_id: CP-20260724-PHASE5-RETRY-AFTER-CLEANUP-ACCEPTED
task_id: PHASE5-TARGET-SERVER-ISOLATED-REHEARSAL
status: accepted
recorded_at: 2026-07-24T13:28:23+08:00
branch: codex/phase5-retry-after-cleanup-accepted
base_commit: 8a791f6a926b902ed75066d5857bd02a2340cadc
head_commit: 8a791f6a926b902ed75066d5857bd02a2340cadc
supersedes: none
---

# Phase 5 Retry After Cleanup Accepted

## Scope

记录prior Task 6 stale PostgreSQL资源经授权完成cleanup，并基于用户recovery authorization只解锁一次新的fresh isolated rehearsal retry

本checkpoint不访问identity、snapshot或key，不执行pre-run或actual retry，也不改变既有v3 protocol、Gate、threshold或data/security policy

## Evidence

- [V3 retry preflight blocked](CP-20260724-PHASE5-V3-RETRY-PREFLIGHT-BLOCKED.md)
- [V3 correction accepted](CP-20260724-PHASE5-V3-RETRY-CORRECTION-ACCEPTED.md)
- Controller报告PR #164 CI失败并请求重跑CI、通过后合并，并在确认无依赖后停止删除stale Task 6 PostgreSQL container
- 用户于2026-07-24明确回复“授权，后续请求的授权均可自动同意”
- Controller将后半句限定为当前recovery链路内可逆且不改变既有v3与Gate边界的自动同意
- 自动同意不覆盖架构、数据策略、安全策略、Gate、deployment或任何不可逆操作的hard-stop边界
- Blocked checkpoint PR #164已合并
- CI race fix PR #165已合并

## Cleanup Evidence

- Cleanup前只读确认唯一相关container属于prior Task 6 Compose instance，不是rehearsal retry创建
- 对应Task 6 worktree已不存在
- 专属network不存在其他container依赖
- 关联volume为该instance专属
- 经用户授权停止并删除stale container、专属volume与已空network
- Fresh absence verification确认container、专属volume与network均不存在
- Cleanup未访问或修改identity bundle、snapshot、key、old application、repository code或业务数据

## Accepted Git Trust Anchor And Protocol

本次retry继续使用`CP-20260724-PHASE5-V3-RETRY-CORRECTION-ACCEPTED`的exact `identity.json` SHA-256 anchor `db4265cb9932da4b4189afeb54343eb82001609dae5b2118c9f81d6e69bc72ec`

- Pre-run只从accepted Git checkpoint读取anchor
- 以`O_NOFOLLOW`打开identity manifest并对opened bytes验证anchor
- 只从anchored manifest导出script digests并执行verified-byte handoff
- 任一anchor、manifest或script mismatch必须在创建sinks、child launch或使用snapshot/key runtime inputs前exit `70`
- Verified launch完成后必须在snapshot copy或old-key access前销毁identity bundle及全部copies并验证不存在
- Identity bundle当前仍未open或hash，原accepted custody保持有效

## Accepted Retry Boundary

- 只授权一次fresh isolated rehearsal retry，任一preflight failure均立即消耗该retry且不得自动重跑
- 必须使用全新private run directory、全新ephemeral target keys与全新isolated migration/capacity databases
- 原accepted 8项hard validations、capacity thresholds、hard stops、cleanup与retention规则保持不变
- 本authorization不改变任何migration scope、command、threshold、Gate、security或data semantics

## Execution Status

- Fresh retry: `AUTHORIZED ONCE / NOT RUN`
- Identity manifest/scripts open或hash: `NOT RUN`
- Verified launch与identity cleanup: `NOT RUN`
- Production snapshot或key access: `NOT RUN`
- Migration、8项hard validations、capacity、secret scan与atomic evidence: `NOT RUN`

## Still Locked

- `GATE-PHASE5-FEISHU-UAT`
- Real Dify与workflow、Prompt或Schema变更
- Feishu callback、邀请代表用户与UAT
- 正式部署、正式数据库、正式流量与公网入口
- Traffic switch、cutover、停止旧服务或销毁旧备份

## Accepted Result

Prior Task 6 stale PostgreSQL资源cleanup已完成并验证不存在；基于用户recovery authorization只解锁一次受既有v3 protocol与原Gate边界约束的fresh retry，所有later Gates保持locked
