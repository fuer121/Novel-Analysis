---
checkpoint_id: CP-20260720-PHASE2-TASK4-TEST-SCOPE-CORRECTED
task_id: PHASE2-TASK4
status: accepted
recorded_at: 2026-07-20T10:18:53+08:00
branch: refactor/phase2-task4-l1
base_commit: f8a7291f3c5bd1fb2300573368a267b52c31d228
head_commit: f8a7291f3c5bd1fb2300573368a267b52c31d228
supersedes: CP-20260720-PHASE2-TASK4-CONTRACT-CORRECTED
---

# Phase 2 Task 4 Test Scope Corrected

## Scope

在 DEC-0006 已接受的实现范围上，只增加 `packages/database/src/schema.integration.test.ts`，用于验证新增 `004` migration 的 down/up 顺序

其他 allowed scope、required behavior、prohibited changes、Gate 和验收标准全部保持不变

## Evidence

- Task 4 focused integration 36/36、lint、typecheck、new、legacy 与项目源验证均通过
- `packages/database/src/schema.integration.test.ts` 的既有测试固定假设最新 migration 为 `003`
- 新增 `004` 后第一次 `migrateDown()` 正确行为是移除 Prompt content 列并保留书库表，既有断言因此稳定失败
- 用户于 2026-07-20 明确授权把该测试文件加入 Task 4 scope

## Corrected Verification Contract

- 第一次 down 验证 `004` 被回滚、Prompt content 列移除且书库表仍存在
- 第二次 down 验证 `003` 书库表按外键逆序移除
- 后续继续验证 `002`、`001` 回滚以及从空库完整 migrate up
- 必须将该 schema integration test 加入 Task 4 最终 focused verification

## Accepted Result

Task 4 可修改 `packages/database/src/schema.integration.test.ts` 并完成 migration roundtrip 验证

本 checkpoint 不接受实现结果，不更新 implementation baseline，也不提前解锁 Task 5
