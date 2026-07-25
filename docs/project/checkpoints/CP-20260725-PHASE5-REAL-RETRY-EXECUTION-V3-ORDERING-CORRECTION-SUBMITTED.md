---
checkpoint_id: CP-20260725-PHASE5-REAL-RETRY-EXECUTION-V3-ORDERING-CORRECTION-SUBMITTED
task_id: PHASE5-REAL-RETRY-EXECUTION-V3
status: submitted
recorded_at: 2026-07-25T22:28:23+08:00
branch: codex/phase5-real-retry-v3-ordering-correction
base_commit: 9911bba503d8d0fd812f5e075dbd9a728a483f73
head_commit: 9911bba503d8d0fd812f5e075dbd9a728a483f73
supersedes: none
---

# Phase 5 Real Retry Execution V3 Ordering Correction Submitted

## Scope

提交Execution V3 Gate的resource absence ordering correction

本correction只替换原Gate required sequence第2步与resource lifecycle相关顺序，不修改其余exact identity、config SHA、snapshot ordering、hard validations、thresholds、single attempt、retention、cleanup或prohibited changes

## Corrected Required Sequence

1. Accepted candidate `preflight`验证exact bundle、tools、repository anchor与large stage bytes
2. Accepted candidate `snapshot-preflight`使用frozen config SHA验证config、repository、stage、snapshot deadline、fingerprint、complete sidecar absence、exact integrity与custody
3. Snapshot-preflight PASS后才允许受控读取old key、生成fresh target encryption与HMAC keys并准备plaintext sentinel
4. Accepted candidate full `execute`重新验证identity、tools、repository、stage、config与snapshot后才消费keys
5. Full execute生成fresh random runId与两套fresh database credentials
6. Lifecycle在任何create前验证该runId对应的两个container名称与两个network名称fresh absence
7. Lifecycle创建两套独立network与container，并在create后绑定immutable ID、labels、loopback port、single anonymous mount与network attachment
8. 执行initialize、migration、8项hard validations与accepted capacity suite
9. 执行完整sentinel、ordinary-output、manifest、provenance、report与final readback扫描
10. 无论成功、失败或取消均清理keys、process、private sinks、verified container、anonymous storage与network
11. Fresh container、network、process、file、local TCP absence全部通过后才允许durable atomic PASS publication，否则只允许sanitized private BLOCKED evidence
12. 执行结果经独立规格与质量review后形成result checkpoint

## Exact Resource Semantics

- Pre-create absence对象：2个fresh container names与2个fresh network names
- Anonymous storage：2份container-owned anonymous mounts，无predeclared name，不执行虚假pre-absence
- Anonymous storage identity：container inspect必须返回single volume mount、non-empty name、expected destination与read-write contract
- Cleanup identity：container与network均使用create返回的immutable ID并在delete前后重新inspect
- Orphan handling：无法证明归属时不得猜测删除，保留sanitized private BLOCKED claim并停止

## Unchanged Contract

- Exactly one attempt，automatic retry false
- Attempt当前仍未开始且未消耗
- Candidate 8-member SHA、V3 config SHA、repository anchor、stage SHA、PostgreSQL image与snapshot deadline不变
- Snapshot-preflight仍先于old key、target keys与plaintext sentinel
- Browse、submit、status、priority与8项migration validations不变
- 任一hard stop消耗attempt，禁止局部补跑或复用部分成功证据
- Dify、飞书、UAT、deployment、traffic switch与cutover继续locked

## Prohibited Changes Audit

- 不修改candidate或config bytes
- 不新增helper、dependency、data object、API、authentication、permission或credential语义
- 不修改migration、Schema、capacity dataset、threshold、priority、Gate结果标准或cleanup语义
- 不读取V3 config、production snapshot、old key或Keychain，不生成target keys
- 不连接Docker daemon、PostgreSQL、Dify、飞书或任何真实环境

## Evidence

- Pre-execution blocked checkpoint证明原六resource pre-snapshot requirement不可执行
- DEC-0029记录用户选择Option A与最小Gate-only correction
- Accepted candidate lifecycle在每个container与network create前执行fresh-name absence
- Accepted candidate通过immutable ID验证container、network与anonymous mount并执行cleanup
- Main与origin/main同步于`9911bba503d8d0fd812f5e075dbd9a728a483f73`且clean

## Decisions Required

本correction submission PR合并后，用户需明确回复

`接受 GATE-PHASE5-REAL-RETRY-EXECUTION-V3-ORDERING-CORRECTION`

该确认恢复既有Execution V3 named authorization的可执行性，不增加attempt count

## Recommended Next Action

先完成本correction PR的CI与合并

用户明确接受correction后，总控创建accepted correction checkpoint，再执行既有唯一一次完整attempt

## Acceptance Request

请求用户接受或拒绝`GATE-PHASE5-REAL-RETRY-EXECUTION-V3-ORDERING-CORRECTION`

接受前attempt保持未开始且未消耗，全部真实资源继续locked
