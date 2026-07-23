---
checkpoint_id: CP-20260723-PHASE5-TASK2-MERGED-TASK3-STARTED
task_id: PHASE5-TASK3
status: accepted
recorded_at: 2026-07-23T11:49:04+08:00
branch: codex/phase5-task2-merged-task3-started
base_commit: 6484b202959ce2fb93c2f133f45fc839a1b9913f
head_commit: 6484b202959ce2fb93c2f133f45fc839a1b9913f
supersedes: none
---

# Phase 5 Task 2 Merged And Task 3 Started

## Scope

记录 PHASE5-TASK2 实现合并，并接受 PHASE5-TASK3 的 fail-closed migration orchestration、CLI、hard validator 与 atomic manifest publication Task Contract

### Core Allowed Modules

- migration orchestration and validator in `packages/migration`
- synthetic PostgreSQL migration integration tests
- synthetic Phase 5 fixtures

### Mechanical Adjacent Scope

- root/package commands
- package build output rules and exports
- Phase 5 Vitest configuration
- direct TypeScript configuration and lockfile metadata required by approved commands

### Success Criteria

- run result 仅有 `status: passed`，包含 elapsed、manifest path、book/chapter counts 与 8 项 passed validation summaries
- CLI 必须显式接收 `--source`、`--database-url`、`--old-key-file`、`--target-key-file`、`--target-hmac-key-file` 与 `--manifest`
- 拒绝 inline key、缺失参数、existing manifest path、implicit key fallback 与 production default
- synthetic two-book migration 完成后严格验证 book count、chapter count、metadata、source integrity、normalized content digest、target decrypt、target HMAC 与 scope exclusion
- source count/title/content drift、target decrypt/HMAC failure、duplicate chapter、non-empty target、manifest collision 与 forced mid-book failure 全部 fail closed
- 任一 hard validation failure 抛出受控 migration hard failure，CLI non-zero exit，不发布 final manifest
- manifest 先写入 same-directory temporary file，mode `0600`、fsync 后仅在全部 hard validation passed 时 atomic rename；失败只删除本次 temporary manifest
- 不自动删除或修复 target，不清理用户文件或已存在 manifest

### Prohibited Changes

- automatic target deletion、repair、truncate 或 destructive migration
- production defaults、implicit key/env/Keychain fallback 或 inline key values
- partial-success exit code zero 或 validation relaxation
- 超出 books/source metadata/chapters 的 legacy L1/L2、history、analysis、user/auth data migration
- real SQLite snapshot、production key、formal data、external system、Feishu、UAT、deployment 或 cutover access
- new table、dependency、architecture、data/security/permission policy、Gate 或 acceptance change

### Required Verification

- observed RED before orchestration/validator implementation
- `npm run test:phase5 -- migration.integration.test.ts` using only synthetic SQLite/PostgreSQL/key files
- focused package tests for CLI argument rejection、non-zero failure exits、atomic `0600` manifest and temp cleanup
- `npm run typecheck -w @novel-analysis/migration`
- `npm run project:check`
- focused lint、`git diff --check` 与 scope audit
- independent specification review followed by independent quality review
- controller `npm run verify:controller` before merge
- CI full verification and post-merge focused smoke/project source check

### Escalation Conditions

- any validation requires less than 100% equality or a warning-only success state
- migration scope must include objects other than books/source metadata/chapters
- execution needs a real snapshot、production/old real key、Keychain、production database or external system
- atomic manifest publication cannot be guaranteed on the same filesystem
- implementation requires target deletion/repair、new table/dependency/architecture/data/security policy or modifies Gate/acceptance
- baseline becomes stale、conflicted or blocked

## Evidence

- PR #137 merged to `main` as `6484b202959ce2fb93c2f133f45fc839a1b9913f` after CI `verify` passed
- Task 2 final specification review was `SPEC_COMPLIANT` and final quality review was `QUALITY_APPROVED` with no unresolved finding
- post-merge target-writer PostgreSQL smoke passed 13/13 and project source check passed
- local `main` and `origin/main` align at `6484b202959ce2fb93c2f133f45fc839a1b9913f` with a clean main worktree
- approved Phase 5 plan orders Task 3 after Task 2 and requires synthetic-only fail-closed validation before any formal operation

## Accepted Result

PHASE5-TASK2 is merged and PHASE5-TASK3 may proceed from this checkpoint's final governance merge SHA using TDD, one implementation worktree and fresh implementer、specification reviewer、quality reviewer agents

This checkpoint does not accept Task 3, unlock Task 4, or authorize real snapshot、old production key、Keychain、Feishu、UAT、deployment or cutover operations
