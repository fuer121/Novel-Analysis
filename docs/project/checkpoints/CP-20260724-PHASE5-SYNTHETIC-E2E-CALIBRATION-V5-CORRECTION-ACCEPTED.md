---
checkpoint_id: CP-20260724-PHASE5-SYNTHETIC-E2E-CALIBRATION-V5-CORRECTION-ACCEPTED
task_id: PHASE5-SYNTHETIC-E2E-CALIBRATION
status: accepted
recorded_at: 2026-07-24T17:30:01+08:00
branch: codex/phase5-synthetic-v5-correction
base_commit: 609688e7ad3ad8b7786b9cf0a554628a666fb7f7
head_commit: 609688e7ad3ad8b7786b9cf0a554628a666fb7f7
supersedes: none
---

# Phase 5 Synthetic E2E Calibration V5 Correction Accepted

## Scope

只修正V4 quality review发现的retained runtime sentinel、原始manifest digest核验与launcher异常清理缺口，并通过focused failure injection固定新的repository-external execution bytes

本checkpoint不执行或授权full synthetic E2E与真实retry，不访问production snapshot、old production key、Keychain、真实演练数据库、Dify或飞书，不推进UAT、deployment、traffic switch或cutover

## Evidence

- Base `main`与`origin/main`同步且clean，SHA为`609688e7ad3ad8b7786b9cf0a554628a666fb7f7`
- Contract tests先以3项RED复现V4 quality findings，修正后3/3 GREEN
- Wrapper将每轮`snapshot_fingerprint`与`database_url`写入随后销毁的private status
- Launcher要求两个runtime sentinel字段存在，收集非空值并加入retained、tracked与untracked repository absolute-zero scan
- Launcher在删除run前读取原始evidence manifest bytes与digest sidecar，重新计算SHA-256并要求algorithm与digest同时匹配
- Launcher在audit中保留原始publication digest与verified结果，success assertion与最终gate均fail-closed
- Spawn error、missing status与malformed或incomplete status均进入受控catch，file descriptors与run目录由无条件finally清理
- Node launcher/helper与POSIX wrapper语法检查通过

## Focused Failure Reproduction

- Missing status：12/12归因为`status_missing`，audit BLOCKED，run absent，outer stdout/stderr `0/0`
- Malformed status：12/12归因为`status_malformed`，audit BLOCKED，run absent，outer stdout/stderr `0/0`
- Incomplete status：保留旧必需字段与atomic metadata但缺少新增sentinel字段，12/12归因为`status_malformed`，未接受publication，retained matches `0`
- Retained runtime leakage：动态fingerprint与database URL进入evidence后检出`retainedSentinelMatches=2`并BLOCKED
- Digest mismatch：success `publicationDigestVerified=false`、publication assertion false并BLOCKED
- 五组harness均无container、volume、network或run残留，未执行Docker、PostgreSQL、migration、capacity或full synthetic

## Fixed Byte Anchors

- Launcher SHA-256：`b80f2a89162f6fced7f4d845ea569bc6f8234d022a32e4a21fcbf0b882ee5977`
- Wrapper SHA-256：`e2fea92e45be4a8960e389daf7a6c2ec36c5dd8164e4bada3a60f6e1da3af948`
- Helper SHA-256：`7bd32a088f33181d818ab73c0f5f361f67402842aec468d2b019b20ceb531b33`
- Candidate目录为`0700`、三个文件均为`0600`且non-symlink
- 五组focused harness catalog与detached digest全部验证通过并绑定exact launcher `b80f2a89...ee5977`

这些anchors只允许提交恰好一次新的full synthetic E2E授权申请，不代表full synthetic已授权或当前字节已成为real retry execution identity

## Independent Review

- Specification review：`SPEC_APPROVED — ALL FIVE FOCUSED HARNESSES BIND THE NEW FROZEN LAUNCHER AND THE V5 CORRECTION MAY PROCEED TO INDEPENDENT QUALITY REVIEW; FULL SYNTHETIC AND REAL RETRY REMAIN LOCKED`
- Quality review：`QUALITY_APPROVED`
- 两轮审查均未发现剩余Critical、Important或阻塞性finding

## Residual Risks And Boundaries

- V5 exact bytes尚未执行full synthetic E2E，不能用focused harness替代真实migration、capacity与success atomic publication证据
- 新full synthetic必须单独获得用户授权且只能执行一次，失败后不得自动重跑
- Real retry、production snapshot、old production key、Keychain、Feishu UAT、deployment与cutover继续locked

## Recommendation

建议提交一次新的full synthetic E2E授权申请，仅使用上述exact bytes、合成快照、合成密钥与一次性PostgreSQL

在用户明确授权前保持所有full synthetic与真实环境操作locked

## Accepted Result

接受V5 correction、focused evidence与独立审查结果，允许进入一次新full synthetic授权Gate，不授权直接执行该Gate
