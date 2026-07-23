---
checkpoint_id: CP-20260723-PHASE5-TASK1-MERGED-TASK2-STARTED
task_id: PHASE5-TASK2
status: accepted
recorded_at: 2026-07-23T11:07:58+08:00
branch: codex/phase5-task1-merged-task2-started
base_commit: e78bf399369eba932213e0026a275f2900584a04
head_commit: e78bf399369eba932213e0026a275f2900584a04
supersedes: none
---

# Phase 5 Task 1 Merged And Task 2 Started

## Scope

记录 PHASE5-TASK1 实现合并，并接受 PHASE5-TASK2 的进程内重加密、per-book transaction 与 manifest Task Contract

### Core Allowed Modules

- `packages/migration`
- existing database cipher interfaces
- existing library tables and their repository/query interfaces

### Mechanical Adjacent Scope

- database exports
- integration fixture
- focused package tests
- existing migration package metadata and exports

### Success Criteria

- injected `oldMasterKey`、`targetCipher` 与独立 `targetHmacKey` 完成 legacy decrypt/HMAC verification 与 target re-encryption，不在 domain function 加载 Keychain 或环境变量
- stable target UUID 仅由 source fingerprint 与 old object identity 派生，不增加 dependency
- 每本书在单一 PostgreSQL transaction 内写入 source metadata 与全部 chapters，任一 decrypt、validation 或 write 失败则该书完整 rollback
- 写入前 fail-closed 验证 target book 不存在，且 migration 不允许在 non-empty target 上继续
- target decrypt roundtrip 与 independent target HMAC 验证通过
- manifest 只包含 source hash、target ID、chapter count、content digest、duration 与 completed status，不包含 plaintext、key、cipher tuple 或 credential
- manifest、captured logs、ordinary errors 与 target plaintext columns 均通过 plaintext/key sentinel 扫描

### Prohibited Changes

- 新 PostgreSQL table 或计划外数据对象
- plaintext persistence
- legacy L1/L2 index、analysis history 或 user data import
- non-empty target 上继续 migration
- legacy runtime、API/Web、Dify workflow、Feishu、auth、permission、Job/lease/outbox 行为变化
- 正式 SQLite、旧生产 key、Keychain、正式数据、UAT、deployment 或 cutover 操作

### Required Verification

- observed RED before writer、stable mapping 与 manifest implementation
- focused PostgreSQL integration tests covering success、corrupt tag、stable mapping、per-book rollback、empty-target enforcement、target decrypt/HMAC roundtrip 与 sentinel scanning
- `TEST_DATABASE_URL=postgres://novel:novel_dev_only@127.0.0.1:55432/postgres npm test -w @novel-analysis/migration -- target-writer.integration.test.ts`
- `npm run typecheck -w @novel-analysis/migration`
- focused lint、`git diff --check` 与 scope audit
- independent specification review followed by independent quality review
- controller `npm run verify:controller` before merge
- CI full verification and post-merge focused smoke/project source check

### Escalation Conditions

- old HMAC or AAD semantics cannot be independently proven
- any synthetic source row cannot decrypt or target roundtrip/HMAC verification fails
- target is non-empty or per-book atomic rollback cannot be guaranteed with existing transaction boundary
- any plaintext、key 或 credential sentinel escapes to persistence、manifest、ordinary errors or captured logs
- implementation requires a new table、dependency、architecture、data/security/permission policy、Gate or acceptance change
- real snapshot、old production key、Keychain、formal data、deployment、UAT or cutover access is needed
- baseline becomes stale、conflicted or blocked

## Evidence

- PR #135 merged to `main` as `e78bf399369eba932213e0026a275f2900584a04` after CI `verify` passed
- Task 1 final specification review was `SPEC_COMPLIANT` and final quality review was `QUALITY_APPROVED` with no unresolved finding
- post-merge migration focused smoke passed 21/21 and project source check passed
- local `main` and `origin/main` align at `e78bf399369eba932213e0026a275f2900584a04` with a clean main worktree
- Phase 5 approved plan orders Task 2 immediately after Task 1 and defines the same module, transaction, security and escalation boundaries

## Accepted Result

PHASE5-TASK1 is merged and PHASE5-TASK2 may proceed from this checkpoint's final governance merge SHA using TDD, one implementation worktree and fresh implementer、specification reviewer、quality reviewer agents

This checkpoint does not accept Task 2, unlock Task 3, or authorize formal snapshot、old key、Feishu、UAT、deployment or cutover operations
