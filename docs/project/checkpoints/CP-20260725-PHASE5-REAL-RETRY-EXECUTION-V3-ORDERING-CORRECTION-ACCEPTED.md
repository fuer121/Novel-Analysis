---
checkpoint_id: CP-20260725-PHASE5-REAL-RETRY-EXECUTION-V3-ORDERING-CORRECTION-ACCEPTED
task_id: PHASE5-REAL-RETRY-EXECUTION-V3
status: accepted
recorded_at: 2026-07-25T22:36:56+08:00
branch: codex/phase5-real-retry-v3-ordering-accepted
base_commit: 1de7e874e5b895674acfed051d608e6aa8409bb9
head_commit: 1de7e874e5b895674acfed051d608e6aa8409bb9
supersedes: CP-20260725-PHASE5-REAL-RETRY-EXECUTION-V3-PRE-EXECUTION-BLOCKED
---

# Phase 5 Real Retry Execution V3 Ordering Correction Accepted

## Scope

接受[Ordering Correction Submitted](CP-20260725-PHASE5-REAL-RETRY-EXECUTION-V3-ORDERING-CORRECTION-SUBMITTED.md)与[DEC-0029](../decisions/DEC-0029-phase5-real-retry-v3-resource-ordering.md)定义的Gate-only resource ordering correction

本checkpoint不增加attempt count，不修改candidate或config bytes

## User Confirmation

用户于`2026-07-25`在correction PR #201合并后明确回复

`接受 GATE-PHASE5-REAL-RETRY-EXECUTION-V3-ORDERING-CORRECTION`

## Corrected Authorization

- Existing authorized attempt：exactly one，仍未开始且未消耗
- Candidate preflight与snapshot-preflight仍先于任何key access
- Full execute二次验证snapshot后读取private inputs并生成fresh runId
- 两个container与两个network名称在对应create前执行fresh absence
- 两份anonymous storage在create后按immutable container ID与single mount identity验证
- 任一absence、identity、execution或cleanup failure消耗attempt，automatic retry false

## Unchanged Contract

- Accepted candidate 8-member identity与V3 config SHA不变
- Repository anchor、stage artifact、PostgreSQL image与snapshot deadline不变
- Migration validations、capacity thresholds、priority、retention与cleanup不变
- Dify、飞书、UAT、deployment、traffic switch与cutover继续locked

## Evidence

- Ordering correction submission PR #201已通过CI并合并
- DEC-0029与correction checkpoint通过project source verification
- 用户提供了exact named correction acceptance
- Main与origin/main同步于`1de7e874e5b895674acfed051d608e6aa8409bb9`且clean
- 本checkpoint创建期间未读取V3 config、snapshot、old key或Keychain，未连接Docker或database

## Accepted Result

原Execution V3 exactly-one authorization恢复可执行状态

总控可按corrected sequence启动唯一一次完整attempt，任何hard stop消耗授权且禁止自动retry
