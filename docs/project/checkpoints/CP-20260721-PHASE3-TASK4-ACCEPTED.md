---
checkpoint_id: CP-20260721-PHASE3-TASK4-ACCEPTED
task_id: PHASE3-TASK4
status: accepted
recorded_at: 2026-07-21T12:49:09+08:00
branch: codex/phase3-task4-query-api
base_commit: e95d5fca215e61b1adeacf99ff5fa4e5b2228f17
head_commit: c60f87f3c8a0b95e405fbf180745b92282e404dd
supersedes: none
---

# Phase 3 Task 4 Accepted

## Scope

接受 Query session HTTP routes、preview scope hash、事务式 turn/job/step/outbox 创建、并发幂等、fallback job 与用户批准的独立 HMAC key 策略

实际 implementation scope 为 Started Contract 批准的六个核心文件，加 `apps/api/src/main.ts` runtime wiring 与 `job-events.integration.test.ts` 直接 runtime verification

## Evidence

### Implementation Agent

- 初始 RED：Query job module 缺失且 Query session route 返回 404，3 failed、1 passed
- 初始实现提交 `76429fab4e8c0d40eb646286614e1c3062ec69d4`
- keyed fingerprint 与独立配置修复提交 `eb1c2412f221b5d78145d04c9a062011407751f9`
- session/fallback/global idempotency 并发修复提交 `4829b2677626657e8a6e130d7584b5c4c3f423da`
- fallback replay authorization 修复提交 `6686987192bb3c1c2be24aab7e26ed9f72fdf4b1`
- 32-byte independent HMAC policy 修复提交 `c60f87f3c8a0b95e405fbf180745b92282e404dd`
- 最终 focused security/Query/API suite 39/39，既有 books/index/jobs route regressions 23/23，typecheck、lint 和 diff check 通过

### Specification Review

- final verdict: APPROVED
- 初审发现跨 book replay identity、加密/HMAC key 复用和明文无键 fingerprint 三项 Important，均以回归 RED 修复
- 并发修复与 replay authorization 修复后完整 Task 4 matrix 均再次复验通过
- 用户批准 Option A 后确认 canonical base64、exact 32-byte、key inequality、service defense-in-depth 与无泄漏符合安全决策
- 最终确认八文件 scope，无 database、contract、Worker、Task 5 或 Gate 扩张

### Code Quality Review

- final verdict: APPROVED
- 初审发现同 session context race、同 turn fallback competition、跨操作 global idempotency race 与弱 HMAC policy 四项 Important
- correction review 发现 revoked visibility replay 一项 Important regression，已修复并关闭
- session create、turn fallback 与 global request key 使用一致且可复现的锁边界，expected unique constraint 才映射为 stable conflict
- fallback exact replay 在返回历史 job 前重新验证当前 visibility、ownership 与 nested resource identity
- 无剩余 Critical、Important 或 Minor finding

### Controller Verification

- `npm run verify:controller` 通过
- legacy 112/112
- new 288 passed with 1 configured smoke skipped
- integration 249/249
- workspace 5/5、contracts 7/7、project source 42/42、manifest、lint、typecheck 和 legacy build 均通过
- `npm run test:phase1:e2e` 通过 2/2
- `npm run test:phase2:e2e` 通过 6/6
- `npm run typecheck:phase2` 通过
- `npm run build -w apps/web` 通过
- `git diff --check` 通过

### Scope And Security Audit

- implementation diff 仅包含六个批准核心文件、API production HMAC wiring 和直接 runtime security test
- 未修改 database、migration、Query repository、public contracts、Worker、executor、queue consumer、lease、outbox protocol、Web、Dify、dependency、lockfile 或 credential file
- question 和 title 的 persisted fingerprint 只基于 keyed HMAC 与非敏感 resource fields，不保存明文或旧 unkeyed hash
- transaction rollback、same-session context drift、same-turn fallback competition、cross-operation idempotency、revoked replay 和 key leakage 均有直接回归测试
- `DEC-0014` 记录用户批准的安全策略，真实凭证与部署仍未执行

## Accepted Result

PHASE3-TASK4 implementation accepted at `c60f87f3c8a0b95e405fbf180745b92282e404dd` and may proceed to PR and CI verification under DEC-0002

Task 5 remains locked until the implementation PR is merged, a merged checkpoint is accepted and the project source names the new main SHA
