---
checkpoint_id: CP-20260725-PHASE5-STAGE-MERGED-IDENTITY-RESTARTED
task_id: PHASE5-REAL-RETRY-IDENTITY
status: accepted
recorded_at: 2026-07-25T01:10:20+08:00
branch: codex/phase5-identity-restarted
base_commit: 72e0d29bb5fade441530e79736deb53c735d794a
head_commit: 72e0d29bb5fade441530e79736deb53c735d794a
supersedes: none
---

# Phase 5 Stage Merged And Identity Restarted

## Scope

记录`PHASE5-REAL-RETRY-STAGE-ENTRY`合并并通过post-merge verification，同时以accepted artifact重新启动`PHASE5-REAL-RETRY-IDENTITY`修正

本checkpoint不接受任何旧candidate，不授权production snapshot、old key、Keychain、真实database、real rehearsal或正式环境操作

## Merged Evidence

- PR #177已合并
- Main与origin/main同步于`72e0d29bb5fade441530e79736deb53c735d794a`
- Stage artifact SHA为`6ea6bebe5cdfee41f9060a270e1a3af8773fc51a8692d097af0900a31d4666f0`
- Post-merge `phase5:stage:check`通过
- Post-merge project source tests `42/42`通过
- Post-merge project source check通过
- Main worktree clean

## Task Contract

- Task ID：`PHASE5-REAL-RETRY-IDENTITY`
- Core allowed modules：repository外新candidate目录中的entry verifier、launcher、wrapper或必要helper、focused synthetic tests、allowlist、catalog、detached digest与sanitized report
- Mechanical adjacent scope：candidate内synthetic fixtures、pure stub commands与review evidence，不修改repository product code
- Base commit：`72e0d29bb5fade441530e79736deb53c735d794a`
- Accepted stage：只允许执行repository committed `scripts/phase5-rehearsal-stage/artifact/stage.mjs`，SHA必须为`6ea6bebe5cdfee41f9060a270e1a3af8773fc51a8692d097af0900a31d4666f0`
- Required trust：Gate checkpoint expected entry SHA作为bundle外trust root，entry self-check、embedded catalog SHA与catalog member hashes形成无环trust chain
- Required execution closure：stage bytes以`O_NOFOLLOW` descriptor读取、`fstat`并hash，随后通过已验证bytes或fd/stdin执行，不得校验后按repository path重读
- Required config and input safety：config、snapshot、key、plaintext与child outputs使用`O_NOFOLLOW` descriptor、`fstat`、owner/mode/type与containment校验并从同一descriptor读取
- Required database isolation：migration与capacity PostgreSQL URL按protocol、hostname、effective port与database path规范化比较，userinfo、query与fragment不得制造虚假隔离
- Required sentinel：从actual snapshot fingerprint、database URLs、old/target/HMAC key bytes、plaintext bytes与resolved private paths派生raw、base64、hex、URL encoding与SHA-256 forms并扫描所有retained与ordinary bytes
- Required retained evidence：不得保存database URL、key、path、snapshot或plaintext的value、encoding、digest或fingerprint，opaque non-derived resource ID除外
- Required publication：success evidence先进入private staging，cleanup与fixed fresh absence全部通过后才可single-rename发布PASS集合，cleanup失败或crash不得留下final PASS
- Required absence：使用exact内置PID、file、local TCP与严格Docker absence probes，不以config command exit `0`作为truth
- Required status：只在validated private root中使用`O_CREAT|O_EXCL|O_NOFOLLOW` write-once status，不覆盖existing target，并复核parent identity
- Required behavior：保持snapshot-before-key/plaintext顺序、canonical deadline `2026-07-30T21:37:42+08:00`、8项validation、browse `<500ms`、submit `<1000ms`、status `<2000ms`与两项priority为true
- Required verification：RED/GREEN focused suites、tamper与TOCTOU targeted reproduction、actual value leakage derivatives、normalized database identity、cleanup-before-PASS crash window、exact hash/mode/owner/symlink/inventory、independent spec与quality review
- Escalation：需要修改repository、stage artifact、migration、Schema、threshold、Gate；需要真实input、database、Docker、network、Dify或飞书；或无法在Node/Bash stable execution中关闭quality findings

## Prohibited Changes

- 复用或接受blocked candidate SHA
- 修改repository product code、stage artifact、dependency、migration、Schema、capacity contract或Gate
- Production snapshot、old key、Keychain、真实credential、database、Docker、Dify、飞书、UAT、deployment、traffic switch或cutover
- 失败后自动real retry

## Evidence

- [Stage entry accepted](CP-20260725-PHASE5-REAL-RETRY-STAGE-ENTRY-ACCEPTED.md)
- [Prior identity quality blocked](CP-20260724-PHASE5-REAL-RETRY-IDENTITY-QUALITY-BLOCKED.md)
- [Real retry Gate contract accepted](CP-20260724-PHASE5-REAL-RETRY-GATE-CONTRACT-ACCEPTED.md)

## Accepted Result

接受stage merged结果并解锁新的repository-external real retry identity candidate实现与双审

Execution confirmation、真实input与real retry继续locked
