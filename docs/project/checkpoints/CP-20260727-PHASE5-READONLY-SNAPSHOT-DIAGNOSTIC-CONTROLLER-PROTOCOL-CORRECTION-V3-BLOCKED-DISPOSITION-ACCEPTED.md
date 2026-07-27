---
checkpoint_id: CP-20260727-PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-CONTROLLER-PROTOCOL-CORRECTION-V3-BLOCKED-DISPOSITION-ACCEPTED
task_id: PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-CONTROLLER-PROTOCOL-CORRECTION-V3-BLOCKED-DISPOSITION
status: accepted
recorded_at: 2026-07-27T09:14:03+08:00
branch: codex/phase5-readonly-snapshot-diagnostic-protocol-v4-gate-accepted
base_commit: b273ffa4be393e6bd432f3f1c79936b0cde6713e
head_commit: b273ffa4be393e6bd432f3f1c79936b0cde6713e
supersedes: CP-20260727-PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-CONTROLLER-PROTOCOL-CORRECTION-V3-BLOCKED-DISPOSITION-SUBMITTED
---

# Phase 5 Read-Only Snapshot Diagnostic Controller Protocol Correction V3 Blocked Disposition Accepted

## Scope

接受controller protocol correction V3的blocked disposition，并解锁一个新的repository-external synthetic-only controller protocol correction V4

V4只允许关闭canonical deadline、raw seal postcondition与prepared-at-deadline ordering三个consolidated Important finding

本checkpoint不授权提前清理V2或V3 retained evidence，不授权读取真实config、snapshot、old key或Keychain，不生成target keys，不连接Docker或database，不修改accepted candidate，也不授权真实diagnostic、UAT、部署、切换或retry

## User Confirmation

用户于`2026-07-27`在submission PR #226合并后明确回复

`接受 GATE-PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-CONTROLLER-PROTOCOL-CORRECTION-V3-BLOCKED-DISPOSITION`

该确认只授权submitted contract中的repository-external synthetic-only V4 correction、strict TDD、new frozen identity、受控raw custody、五维fresh observation与独立双审

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

## Accepted Protocol Boundary

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

## Evidence

- Submission PR #226的`CI/verify`通过并已合并
- PR #226 merge commit为`b273ffa4be393e6bd432f3f1c79936b0cde6713e`
- `main`与`origin/main`在本checkpoint创建前同步于该merge commit且clean
- `npm run controller:health`fresh通过并报告0个dirty worktree
- 用户在exact synthetic-only contract合并后提供named confirmation
- V2与V3 attempt均保持`executed`、双failed verdict、raw custody intact、deadline future且cleanup pending
- V2与V3 frozen identity均未修改，synthetic attempt均未补跑
- Custody continuity automation保持active，V2时间未延后且V3 handoff存在
- 本checkpoint未读取raw bytes、private pointer value、candidate bytes或真实路径
- 本checkpoint未访问任何真实输入、Docker、database、Dify、飞书或部署环境

## Accepted Result

解锁repository-external synthetic-only controller protocol correction V4、strict TDD focused tests、new frozen identity、受控cleanup与独立双审

真实config与snapshot访问、accepted candidate修改、read-only diagnostic、目标服务器演练、真实retry、飞书UAT、部署与切换继续locked
