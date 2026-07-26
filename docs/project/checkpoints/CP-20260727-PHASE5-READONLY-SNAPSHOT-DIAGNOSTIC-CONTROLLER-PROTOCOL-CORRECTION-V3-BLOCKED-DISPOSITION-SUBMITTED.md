---
checkpoint_id: CP-20260727-PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-CONTROLLER-PROTOCOL-CORRECTION-V3-BLOCKED-DISPOSITION-SUBMITTED
task_id: PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-CONTROLLER-PROTOCOL-CORRECTION-V3-BLOCKED-DISPOSITION
status: submitted
recorded_at: 2026-07-27T00:47:55+08:00
branch: codex/phase5-readonly-snapshot-diagnostic-protocol-v4-gate-submitted
base_commit: 95d4424dc47236d051d8b8601cde6e6879086fd5
head_commit: 95d4424dc47236d051d8b8601cde6e6879086fd5
supersedes: none
---

# Phase 5 Read-Only Snapshot Diagnostic Controller Protocol Correction V3 Blocked Disposition Submitted

## Gate

`GATE-PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-CONTROLLER-PROTOCOL-CORRECTION-V3-BLOCKED-DISPOSITION`

本Gate只提交一个新的repository-external synthetic-only controller protocol correction V4 contract，用于关闭V3独立review确认的三个consolidated Important findings

在用户明确接受本Gate全名之前，V4不得启动；本submission不授权修改V3 frozen identity、补跑V3 attempt、提前cleanup、真实config或snapshot访问、read-only diagnostic、UAT、部署、切换或retry

## Blocked Facts

- V3 accepted baseline为`63/63 PASS`
- V3 combined focused protocol为`50/50 PASS`
- V3 frozen identity为exact 13-file inventory，其中11个members绑定manifest
- V3唯一synthetic attempt为exit `0`，三项raw sinks均exact-zero owner-owned `0400`且custody intact
- V3 specification与quality pre-cleanup verdict均为failed
- V3 review findings合并为canonical deadline、raw seal postcondition与prepared-at-deadline ordering三个Important blocker
- V3 cleanup targets均保持pending，hard custody deadline为`2026-07-28T00:12:36.047+08:00`
- V2与V3 deadline cleanup continuity已建立

## Task Contract

- Task ID：`PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-CONTROLLER-PROTOCOL-CORRECTION-V4`
- Core allowed modules：new repository-external synthetic controller protocol V4、canonical retention state、resume clock validation、raw identity seal postconditions、all-path reference publication ordering与focused tests
- Mechanical adjacent scope：synthetic fixtures、operation dependency injection、fake clock、new frozen manifest、sanitized evidence schema、review registrar与exact-target cleanup proof
- Base commit：`95d4424dc47236d051d8b8601cde6e6879086fd5`
- Base identity：V3 blocked checkpoint、V3 deadline custody checkpoint、accepted 8-member candidate与V3 frozen evidence只读基线；不得修改或补跑V3 identity
- Success criteria：关闭三个consolidated Important findings，strict TDD与V3完整50-test regression通过，新V4 frozen identity完成唯一synthetic attempt、pre-cleanup双审、受控cleanup、五维post-cleanup双审且无Critical、Important或阻塞finding
- Prohibited changes：V2或V3 retained evidence提前cleanup、真实输入或runtime访问、accepted candidate或权限修改、diagnostic allowlist修改、snapshot写入或修复、key访问、Docker、database、migration、capacity、Dify、飞书、UAT、部署、切换、cutover或retry
- Required verification：canonical retention roundtrip、within-bound deadline extension与shortening、zero window、clock rollback、raw regular type、owner、symlink absence与effective `0400`、no-op chmod、prepared-deadline reference exception、execute与restart ordering、existing V3 50-test matrix、sensitive-data scan、独立规格与质量双审
- Escalation conditions：任一V2或V3 custody冲突、真实输入需求、candidate或Gate语义变化、raw custody超期、Critical、Important、阻塞finding或证据冲突必须停止

## Proposed Protocol Boundary

1. V4必须使用新的repository-external root与new frozen identity，不得原地修改V2或V3文件、attempt state或retained evidence
2. V2与V3 retained evidence继续由既有deadline continuity独立cleanup，V4不得消费或销毁旧evidence
3. Attempt创建时必须atomic记录canonical positive retention、safe-integer `startedAt`与exact `deadlineAt = startedAt + retentionMs`
4. Resume必须重新验证canonical retention bounds、exact deadline equality与`now >= startedAt`，并拒绝extension、shortening、zero window、clock rollback、noncanonical state或overflow
5. Raw seal必须在任何reference publication前强制每个raw sink为regular non-symlink file、current owner、effective `0400`且digest可重算
6. Chmod、type、owner、mode、stat或digest任一postcondition失败都必须在reference publication前停止并保持可恢复的`BLOCKED` custody state
7. Execute、restart recovery与prepared-at-deadline enforcement等所有reference publication path必须遵守同一seal-first atomic custody顺序
8. 两位独立reviewer必须基于同一V4 frozen manifest与相同raw digests完成pre-cleanup review
9. Deadline前只有两项review都passed才能cleanup；deadline到达时必须cleanup并保持`BLOCKED`
10. Cleanup后必须完成process、file、key、local TCP与task-owned runtime五维fresh observation及独立双审

V4 correction通过完整双审后只能创建correction result checkpoint，不得自动提交或执行新的read-only snapshot diagnostic Gate、UAT、Deployment Gate或Cutover Gate

## Prohibited Changes Audit

- 未读取、复制、打开、hash或修改真实config、snapshot、keys、Keychain、credential或plaintext
- 未连接Docker daemon、PostgreSQL、Dify、飞书、部署或正式环境
- 未修改accepted candidate、V2或V3 frozen identity、permissions、diagnostic allowlist、Gate顺序或验收标准
- 未执行synthetic attempt补跑、真实diagnostic、真实retry、migration、capacity、UAT、deployment、traffic switch或cutover
- 未删除raw sinks、private references或其他retained evidence
- 未读取或输出private pointer value、真实路径、candidate bytes或raw log

## User Confirmation Required

只有用户在本submission通过PR、CI并合并后明确回复

`接受 GATE-PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-CONTROLLER-PROTOCOL-CORRECTION-V3-BLOCKED-DISPOSITION`

才授权创建新的repository-external V4 root并启动strict TDD

其他回复、部署要求、既有Gate确认或旧reviewer状态都不得解释为该Gate已接受
