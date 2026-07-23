---
checkpoint_id: CP-20260723-PHASE5-TASK1-ACCEPTED
task_id: PHASE5-TASK1
status: accepted
recorded_at: 2026-07-23T11:02:49+08:00
branch: codex/phase5-task1
base_commit: 6158e7612b8bec0105abfb72019a00b3e54532f9
head_commit: 7e84fffe7a1951ee056546c3d9ad90fdb91c30c4
supersedes: none
---

# Phase 5 Task 1 Accepted

## Scope

接受 Phase 5 migration contracts、只读 legacy snapshot reader 与 synthetic fixture 实现

实际 scope 为 `packages/migration/**`、`test/phase5/fixtures/create-legacy-snapshot.ts` 与 root lockfile，没有修改 legacy `server/db.js`、PostgreSQL schema、正式 SQLite、Keychain、Dify workflow、API/Web 行为或正式环境

## Accepted Behavior

- 定义 immutable legacy book/chapter records 与 snapshot reader port
- SQLite 以 `{ readOnly: true }` 打开并启用 `PRAGMA query_only = 1`
- 打开前、打开后与关闭时拒绝非空 WAL/SHM sidecar，并以 SHA-256 校验主文件未改变
- 使用准确 AAD `chapter:${bookId}:${chapterIndex}`，fixture 的 AES-GCM 与 HMAC 使用同一 synthetic master key
- 验证 required schema、AES-256-GCM cipher tuple、非空 identity、positive safe chapter index、duplicate 与 orphan records
- 保留 legacy 合法空书名、空章节名与空 plaintext ciphertext
- read-only opener seam 仅供模块内部测试观察，不作为 package API 导出

## Review And Corrections

- 最终规格审查：`SPEC_COMPLIANT`，无 finding
- 最终质量审查：`QUALITY_APPROVED`，无 Critical、Important 或 Minor finding
- 审查期间修复四类阻塞项：WAL sidecar fingerprint 边界、fixture AAD/HMAC 真实性、invalid/duplicate/orphan identity 校验、read-only/query-only 可观察证据
- 最终 correction 移除过度校验，允许 legacy schema 中合法的空标题与空章节明文

## Evidence

- 实现 Agent RED/GREEN：focused migration tests 从缺失实现失败转为 21 passed
- `npm test -w @novel-analysis/migration -- legacy-reader.test.ts`：21 passed
- `npm run typecheck -w @novel-analysis/migration`：passed
- `git diff --check 6158e7612b8bec0105abfb72019a00b3e54532f9..7e84fffe7a1951ee056546c3d9ad90fdb91c30c4`：passed
- 总控 `npm run verify:controller`：legacy 112、contracts 7、new 397 with 1 skipped、project source 42、workspace 5、PostgreSQL integration 335 全部通过
- lint、typecheck、legacy build、Dify manifest 与 project source check 全部通过
- scope audit：8 个实现文件全部属于 core allowed modules 或 mechanical adjacent scope

## Accepted Result

PHASE5-TASK1 实现已接受，可以创建 implementation PR，等待 CI 后按既有自动 PR 授权合并

Task 2 与正式 snapshot、旧 key、Feishu callback、UAT、deployment、cutover 仍未解锁

## Deferred Items

- repository dependency audit 现有 7 个 vulnerability，超出 Task 1 scope
- Phase 5 Tasks 2 至 8
- `GATE-PHASE5-TOOLS-ACCEPTED`
- 正式数据、部署、UAT 与切换
