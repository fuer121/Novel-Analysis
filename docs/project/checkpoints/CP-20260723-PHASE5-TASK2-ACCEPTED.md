---
checkpoint_id: CP-20260723-PHASE5-TASK2-ACCEPTED
task_id: PHASE5-TASK2
status: accepted
recorded_at: 2026-07-23T11:44:04+08:00
branch: codex/phase5-task2
base_commit: 3395aede518d1ba9b62e276b066ea12fbd5b1131
head_commit: b389c3974fbca38b0206e749b57a752dfda3bea0
supersedes: none
---

# Phase 5 Task 2 Accepted

## Scope

接受 Phase 5 进程内 legacy decrypt/HMAC verification、stable target ID、per-book PostgreSQL transaction、target re-encryption/HMAC 与 secret-free manifest 实现

实际 scope 为 `packages/migration/**`、现有 database package 的 `sql` mechanical export 与 root lockfile，没有新增 table、schema migration、external dependency、legacy/API/Web/Dify/Feishu/auth/permission/Job/lease/outbox 语义或正式数据操作

## Accepted Behavior

- domain function 只接受 injected old master key、target `ContentCipher` 与独立 target HMAC key，不读取环境变量或 Keychain
- legacy AES-256-GCM 使用准确 AAD `chapter:${bookSourceId}:${chapterIndex}`，same-key HMAC 使用 timing-safe comparison
- key buffer 在构造时复制，old/HMAC key 均严格为 32 bytes，并拒绝相同 key
- target UUID 由 source fingerprint 与 old identity 通过 SHA-256 稳定派生，设置合法 UUID version/variant bits，无新增 dependency
- `book_sources` 写入 `provider: legacy-sqlite`、old book ID 与迁移章节 min/max position
- 每本书在单一 transaction 内写入，先取得 `books` table `SHARE ROW EXCLUSIVE` lock，再执行 global empty-target/owned-book check，防止非协作并发 DML 污染目标
- decrypt、HMAC、validation、target conflict 或 write failure 均保持单书 all-or-none rollback
- target decrypt roundtrip 与独立 target HMAC verification 通过
- manifest 仅包含批准的 source hash、target ID、chapter count、content digest、duration 与 completed status，不包含 plaintext、key、cipher tuple 或 credential
- manifest、captured logs、ordinary errors 与 target plaintext columns 通过 sentinel 扫描

## Review And Corrections

- 初次规格审查发现 1 个 Important：package test config 使 Task 1 unit command 误选 integration suite；修复后最终 `SPEC_COMPLIANT`
- 初次质量审查发现 3 个 Important：global empty-target concurrency window、caller-owned mutable key alias、contract command false-positive suite selection
- 修复采用 existing table transaction lock、internal exact-size key copies 与 migration-local Vitest config，没有增加 schema、dependency 或新业务语义
- 最终规格确认：`SPEC_COMPLIANT`，无 finding
- 最终质量复审：`QUALITY_APPROVED`，无 Critical、Important 或 Minor finding

## Evidence

- 实现 Agent 有效 RED：writer/manifest modules 缺失导致 focused PostgreSQL test 失败
- exact legacy command：`npm test -w @novel-analysis/migration -- legacy-reader.test.ts`，21/21 passed 且只运行 legacy reader file
- exact Task 2 command：`TEST_DATABASE_URL=postgres://novel:novel_dev_only@127.0.0.1:55432/postgres npm test -w @novel-analysis/migration -- target-writer.integration.test.ts`，13/13 passed 且只运行 target writer file
- deterministic two-connection test 证明 external insert 先持锁时 migration 等待后 fail `target_not_empty`，最终只保留 external book 且无 migrated chapter
- 独立质量 reproduction 证明 migration 持锁期间非协作 INSERT、UPDATE、DELETE 均被阻塞，并在释放后按合法 serial order 执行
- caller buffer mutation、31-byte 与 33-byte target HMAC key cases 均通过
- migration 与 database typecheck、focused ESLint、`git diff --check` 与 scope audit 通过
- 总控 `npm run verify:controller` 全部通过：legacy 112、contracts 7、new 397 with 1 skipped、project source 42、workspace 5、PostgreSQL integration 348
- lint、typecheck、legacy build、Dify manifest 与 project source check 全部通过

## Accepted Result

PHASE5-TASK2 实现已接受，可以创建 implementation PR，等待 CI 后按既有自动 PR 授权合并

Task 3、正式 SQLite snapshot、旧生产 key、Keychain、Feishu callback、UAT、deployment 与 cutover 仍未解锁

## Deferred Items

- repository dependency audit 现有 7 个 vulnerability，超出 Task 2 scope
- Phase 5 Tasks 3 至 8
- `GATE-PHASE5-TOOLS-ACCEPTED`
- 正式数据、部署、UAT 与切换
