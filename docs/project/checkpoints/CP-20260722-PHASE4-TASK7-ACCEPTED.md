---
checkpoint_id: CP-20260722-PHASE4-TASK7-ACCEPTED
task_id: PHASE4-TASK7
status: accepted
recorded_at: 2026-07-22T22:02:19+08:00
branch: codex/phase4-task7-acceptance-evidence
base_commit: 6554241401f76d6cff9dd1a969fea5b5a219bd8f
head_commit: ab0f18abbaa5e9b3ae994ba8ee36a38b0c70326a
supersedes: none
---

# Phase 4 Task 7 Accepted

## Scope

接受 Phase 4 独立 API、Worker、PostgreSQL、deterministic Dify、恢复、隐私、删除、legacy、sentinel 与 viewport 验收证据

实际 scope 仅为 `package.json` Phase 4 test script、`vitest.phase4.config.ts` 与 `test/phase4/**`，没有产品 runtime、API、database、migration、dependency、auth、security、queue、lease、deployment、formal data 或 Gate 变化

## Evidence

- real API、Worker、disposable PostgreSQL 与 HTTP Dify fake harness 独立启动并捕获日志
- four-mode 真实 provider inputs、preview counts、review budget 与 `decryptFrozenChapter=108` 精确对应 `0+3+5+100`
- DEC-0016 snapshot 对 template、index、execution versions、source policy 与逐章 HMAC/L1/L2 做完整 exact comparison
- SIGKILL、lease expiry、Worker restart、outbox replay 与 duplicate create 只形成一个 terminal result，不重复 committed part
- member/admin 不能读取 owner terminal result；admin metadata/control projection 无内容字段
- active delete 被拒绝，cancel 后 terminal owner hard delete 清除 business graph 且保留 audit；legacy fixture 仅支持 GET
- 成功结果 summary/item label 双 sentinel 与 chapter、fact、provider error、Dify keys、Feishu secret、session/CSRF、content/HMAC keys 在批准 persistence、ordinary APIs、admin metadata、logs、events、outbox、attempts 与 audit 表面完成正负扫描
- balanced chapter 7 的三次真实 provider context 均包含 chapter 与 L2 fact sentinel，随后 controlled error 与所有普通表面无泄漏
- 1440、1280、768、390 真实浏览器验收及 fail-closed geometry/drawer/result/task control 断言通过
- 规格复审与质量/安全复审最终均 APPROVED，无 unresolved Critical、Important、Minor 或 blocking finding
- 总控 `npm run test:phase4:e2e` 8/8 与 `npm run verify:controller` 全部通过：legacy 112、new 376 with 1 skipped、integration 335、project source 42、workspace 5、lint、typecheck、build、Dify manifest 与 project check
- `git diff --check`、九文件 allowed scope audit 与 clean worktree 通过
- PR #128 CI `verify` 通过，head SHA 与本 checkpoint 一致且 PR 可合并

## Accepted Result

PHASE4-TASK7 实现证据已接受，可以合并 PR #128

本 checkpoint 不通过 `GATE-PHASE4-IMPLEMENTATION-ACCEPTED`；Gate 只可在 Task 7 merged checkpoint 后由用户明确决定

## Deferred Items

- Phase 4 implementation Gate 明确决策
- 正式数据、部署、UAT、切换与 Phase 5 工作
