---
checkpoint_id: CP-20260723-PHASE5-TASK3-ACCEPTED
task_id: PHASE5-TASK3
status: accepted
recorded_at: 2026-07-23T12:28:21+08:00
branch: codex/phase5-task3
base_commit: 94d17771f1f655943b0bf276c5d0e76a4967279c
head_commit: d8bdfdc9113c8c708a427e1f0c878e1b0ef863e7
supersedes: none
---

# Phase 5 Task 3 Accepted

## Scope

接受 Phase 5 synthetic-only migration orchestration、hard validator、strict CLI、atomic no-clobber manifest publication 与 integration harness

实际 scope 为 `packages/migration/**`、synthetic Phase 5 fixture/test、Phase 5 Vitest config 与批准的 root/package commands，没有新增 table、dependency、production default、implicit key fallback、target deletion/repair、正式数据或外部系统访问

## Accepted Behavior

- `MigrationRunResult` 仅允许 `status: passed`，包含 elapsed、manifest path、book/chapter counts 与 ordered validation summaries
- CLI 强制六个显式 flags：source、database URL、old key file、target key file、target HMAC key file、manifest；拒绝 missing、duplicate、unknown、positional、inline key、existing manifest 与 invalid URL
- key files 必须为 raw 32-byte 且三把 key pairwise distinct，不读取 env、Keychain 或 production default
- hard validation 顺序固定为 book-count、chapter-count、metadata、source-integrity、content-digest、target-decrypt、target-hmac、scope-exclusion，全部要求 100% equality
- count/title/content drift、decrypt/HMAC failure、duplicate chapter、non-empty target、manifest collision 与 mid-book exception 全部 fail closed
- per-book transaction 内第二章 forced failure 证明 failed book/source/chapter graph 完整 rollback，已完成第一本保留，final manifest 不发布
- manifest 先写入 same-directory unique temp，`wx`、mode `0600`、file fsync，再通过 hard link 原子 no-clobber publication
- hard link 是 publication commit point：commit 前失败无 final；commit 后 maintenance best-effort，避免 final 已存在但 CLI 返回失败的歧义
- `EEXIST` fail closed 并 byte-for-byte 保留 raced user manifest；cleanup 只触碰 uniquely owned temp，绝不删除或替换 final
- CLI hard failure non-zero 且输出受控脱敏 code，不输出 key、content、database URL 或内部 stack

## Review And Corrections

- 初次规格审查发现 1 个 Critical：`access` + `rename` TOCTOU 可覆盖用户 manifest；以及 2 个 Important evidence gap：content drift 与 mid-book failure 未被真实覆盖
- 修复为 atomic hard-link no-clobber publication，并补 valid re-encryption digest drift 与 PostgreSQL trigger mid-book rollback tests
- 初次质量审查发现 1 个 Important：link 后 cleanup/fsync failure 会返回失败但 final 已发布
- 修复定义 hard link 为明确 commit point，并补 unlink、directory open/sync/close fault-injection tests
- 最终规格确认：`SPEC_COMPLIANT`，无 finding
- 最终质量复审：`QUALITY_APPROVED`，无 Critical、Important 或 Minor finding

## Evidence

- 有效 orchestration RED：missing `run.js`；有效 CLI RED：missing `cli.js`
- exact Phase 5 command `npm run test:phase5 -- migration.integration.test.ts`：intended file 2/2 passed
- full migration package synthetic PostgreSQL suite：4 files，64/64 passed
- orchestration：20/20 passed；CLI unit：10/10 passed
- manifest race test 证明 raced sentinel byte-identical preserved；post-link unlink/open/sync/close fault cases 均保持 passed final mode `0600`
- content drift 使用 valid target re-encryption + recomputed HMAC，sole failure 为 `content-digest`
- mid-book trigger test 证明第二本全图 rollback、第一本完整保留且无 final manifest
- migration typecheck、bundle build、redacted CLI process smoke、focused lint、project source、diff-check 与 scope audit 通过
- 总控 `npm run verify:controller` 全部通过：legacy 112、contracts 7、new 407 with 1 skipped、project source 42、workspace 5、PostgreSQL integration 368
- lint、typecheck、legacy build、Dify manifest 与 project source check 全部通过

## Accepted Result

PHASE5-TASK3 实现已接受，可以创建 implementation PR，等待 CI 后按既有自动 PR 授权合并

Task 4、正式 SQLite snapshot、旧生产 key、Keychain、Feishu callback、UAT、deployment 与 cutover 仍未解锁

## Deferred Items

- repository dependency audit 现有 7 个 vulnerability，超出 Task 3 scope
- Phase 5 Tasks 4 至 8
- `GATE-PHASE5-TOOLS-ACCEPTED`
- 正式数据、部署、UAT 与切换
