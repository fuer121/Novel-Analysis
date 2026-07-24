---
checkpoint_id: CP-20260724-PHASE5-RETRY-CONTAINMENT-BLOCKED
task_id: PHASE5-TARGET-SERVER-ISOLATED-REHEARSAL
status: accepted
recorded_at: 2026-07-24T13:49:22+08:00
branch: codex/phase5-retry-containment-blocked
base_commit: 8c85206e032605508147c4d8f35536f0e7679857
head_commit: 8c85206e032605508147c4d8f35536f0e7679857
supersedes: none
---

# Phase 5 Retry Containment Blocked

## Scope

记录cleanup后授权的唯一fresh isolated rehearsal retry在expected-path containment preflight阶段fail-closed

本checkpoint不修改任何accepted protocol、anchor、Gate或threshold，不授权自动重跑

## Evidence

- [Retry after cleanup accepted](CP-20260724-PHASE5-RETRY-AFTER-CLEANUP-ACCEPTED.md)
- Fresh target preflight全部通过，包括authorized SHA与clean state、old application live、idle/no-concurrent、prior Task 6 container/volume/network absence与custody capability
- 随后为expected-path containment创建fresh empty private run context
- Containment执行器错误比较expected path parent的上级与run root，首个path check以exit `70` fail-closed
- Failure发生在identity open/hash、verified launch、snapshot/key access或任何rehearsal command前

## Result

- Outcome: `BLOCKED`
- Failure stage: expected-path containment preflight
- Failure class: containment comparison used the expected parent directory's parent instead of the expected parent itself
- Cleanup后唯一retry: `CONSUMED`
- Automatic retry: `PROHIBITED`

## Not Run

- Identity manifest/scripts open或hash: `NOT RUN`
- Verified launch与identity cleanup: `NOT RUN`
- Production snapshot bytes、fingerprint或working copy: `NOT RUN`
- Keychain、old production key或ephemeral keys: `NOT RUN`
- PostgreSQL container或database创建: `NOT RUN`
- Migration CLI与manifest: `NOT RUN`
- Eight hard validations: `NOT RUN`
- Capacity suite与threshold evaluation: `NOT RUN`
- Secret scan与atomic evidence publication: `NOT RUN`
- Real Dify、Feishu、UAT、deployment、traffic与cutover: `NOT RUN`

## Cleanup And Preservation

- Fresh empty run context、preflight sink与pointer已清理并fresh absence verified
- 未创建新的container、database、snapshot copy、key、migration artifact、capacity artifact或raw rehearsal output
- Canonical snapshot与identity bundle均未打开或修改，保持原accepted custody
- Old application保持live且未修改
- Repository保持clean

## Required Correction Before Any New Retry

- 必须对完整preflight wrapper执行repository-external synthetic correction，不能只定向修补单个expression
- Synthetic correction必须覆盖expected-path containment、parent/run-root比较、first-path failure、cleanup与absence行为
- Correction必须完成独立spec与quality review
- 只有correction被明确接受后，才可提出并接受任何新的single retry authorization
- 原v3 Git anchor、verified-byte protocol、8项hard validations、capacity thresholds、hard stops、cleanup与retention边界保持不变

## Gate Impact

- 本次唯一retry已消耗，不得自动重跑
- `GATE-PHASE5-FEISHU-UAT`及所有later Gates保持locked
- 本次blocked结果没有产生可用于rehearsal或later Gate的migration、validation、capacity或security evidence

## Accepted Result

接受本次retry outcome为`BLOCKED`，下一步仅限完整preflight wrapper的repository-external synthetic correction、独立审查与后续明确授权流程
