---
checkpoint_id: CP-20260722-PHASE4-TASK3-CONTRACT-CORRECTION
task_id: PHASE4-TASK3
status: accepted
recorded_at: 2026-07-22T08:33:23+08:00
branch: codex/phase4-task3-analysis-api
base_commit: 220a20ca1b1bfb3c9ee6b7bae0262a16a2655c97
head_commit: 231aee15033b7e16a4cfaf6a77a7cf9dee5f1699
supersedes: CP-20260722-PHASE4-TASK2-MERGED-TASK3-STARTED
---

# Phase 4 Task 3 Contract Correction

## Scope

修正 PHASE4-TASK3 Task Contract，采用 DEC-0016 的完整加密 execution snapshot，并恢复被规格审查锁定的实现

### Added Core Allowed Modules

- `packages/database/src/migrations/008_analysis_execution_snapshot.ts`
- `packages/database/src/migrations/index.ts`
- `packages/database/src/db.ts`
- `packages/database/src/analysis/analysis-repository.ts`
- `packages/database/src/analysis/analysis-repository.integration.test.ts`
- `packages/database/src/schema.integration.test.ts`
- directly corresponding contracts schema/test for the strict encrypted snapshot and preview projection
- existing API runtime configuration wiring required to inject `AdvancedAnalysisExecutionConfig`

原 checkpoint 的 core allowed modules 与 mechanical adjacent scope 继续有效

### Corrected Success Criteria

- `analysis_runs` 通过可逆 migration 增加完整 all-or-none 加密 execution snapshot tuple，不新增 table 或其他数据对象
- preview 与 create 共享同一个 authoritative execution config 和 source selection，公开 projection 返回真实 execution versions 与 source summary
- create transaction 冻结并加密保存 selected chapters、content HMAC/source version、L1 inputs、完整 L2 fact set、index/template/workflow/config versions、mode/range/scope hash
- existing run snapshot 在章节、L1、L2、index config 或 workflow 后续变化后保持可解密、可验证且字节不漂移
- production model、reasoning effort 与 executor version 来自显式注入配置，缺失或无效时 fail-closed，禁止硬编码虚构值
- Job config、event、outbox、audit、日志、管理员 projection 与普通错误不包含 snapshot 解密内容或其他敏感正文
- Task 3 不实现 snapshot-driven Worker execution，Task 4 必须只消费冻结 snapshot

### Corrected Required Verification

- migration RED、all-or-none tuple constraint、down/up roundtrip 与既有对象保留
- L2 facts 非空时创建 snapshot，随后覆盖重建/删除 current L2 facts，旧 run snapshot 仍可解密得到原 fact IDs 与 payload
- chapter、L1、L2、index config、workflow 或 execution config 变化导致新 preview scope hash 改变，既有 snapshot 不变
- missing/invalid production execution config fail-closed，测试 config 显式注入
- raw row、Job/event/outbox/audit/log/error/admin plaintext sentinel scan
- 原 Task 3 concurrent idempotency、full graph rollback、privacy、CSRF、admin metadata 与 hard-delete verification 全部保持
- focused database schema/repository、analysis Job 与 API PostgreSQL integration tests
- contracts、`npm run typecheck:phase3`、`npm run lint`、diff/scope/plaintext audit、独立规格与质量复审

### Prohibited Changes

- fifth analysis table、append-only L2 version store、L2 retention semantic change or formal data operation
- snapshot plaintext in ordinary JSON or any administrator content access
- hardcoded model、reasoning effort、executor version or silent production default
- Worker execution、lease、Dify invocation、Web、legacy、dependency、lockfile、deployment、UAT、cutover、Gate or task order change
- original Task 3 prohibited changes remain effective unless explicitly superseded above

### Escalation Conditions

- complete encrypted snapshot still requires another table、L2 retention change or sensitive plaintext persistence
- API and future Worker cannot share one explicit execution config contract without architecture changes beyond DEC-0016
- migration cannot remain reversible or requires formal data backfill
- original Task 3 escalation conditions remain effective

## Evidence

- first Task 3 specification review identified incomplete preview projection、immutable snapshot and verification coverage，implementation correction closed the projection and verification gaps
- second specification review proved L2 facts remain unrecoverable after `putL2Facts` replacement and execution config values were hardcoded without an accepted source
- Task 3 worktree is clean at `231aee15033b7e16a4cfaf6a77a7cf9dee5f1699`，focused PostgreSQL 12、contracts 103、typecheck、lint、diff and scope checks passed before the blocker
- user explicitly selected encrypted per-run snapshot方案 A，rejecting global L2 version retention and current-state drift

## Accepted Result

PHASE4-TASK3 may resume only after this correction merges，using the same implementation worktree and independent specification then quality review

This correction does not accept Task 3、unlock Task 4、authorize Worker execution or permit formal data operations
