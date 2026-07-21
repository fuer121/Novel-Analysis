---
checkpoint_id: CP-20260721-PHASE3-TASK5-ACCEPTED
task_id: PHASE3-TASK5
status: accepted
recorded_at: 2026-07-21T14:11:08+08:00
branch: codex/phase3-task5-query-executor
base_commit: 0405f534a7250740608d07b6a060e55ef0640f13
head_commit: dcc3b679d12a07d11aa534fa4f81396f18f8aaa9
supersedes: none
---

# Phase 3 Task 5 Accepted

## Scope

接受 Query executor、不可变 evidence snapshot、Dify summary 与本地 fallback、lease recovery、late-result fencing，以及相互隔离的 background 和 interactive queue consumers

实际 implementation scope 为 Started Contract 批准的 Worker 核心文件，加直接 Worker integration tests 与 Phase 1 controlled Worker harness wiring

## Evidence

### Implementation Agent

- 初始实现提交 `cd1844d430cd79ebd35f1ccf9ccf8998af879845`
- claim disposition 与 replay coverage 修复提交 `811874f9052b931490510e2775e21170949cfe5e`
- partial consumer registration rollback 修复提交 `dcc3b679d12a07d11aa534fa4f81396f18f8aaa9`
- RED 覆盖缺失 executor、独立 Query consumer、Query routing、empty-window recall、失去 claim 后误报 completed 与第二个 consumer 注册失败
- 最终 focused Worker 和 Query integration 25/25，full integration 260/260，Phase 1 E2E 2/2，Phase 2 E2E 6/6
- typecheck、lint、diff check、plaintext/credential sentinel 与 scope audit 通过

### Specification Review

- final verdict: APPROVED
- 初审发现 recall-time claim disposition 被误报为 completed，以及 retry、queue isolation、duplicate wake 和 exact outbox replay 缺少直接证据两项 Important
- correction 后确认真实 `CompletionDisposition` 被传播，retry-summary 复用原 evidence version
- blocked background、duplicate wake 与 outbox replay 均有直接集成覆盖和 exact count assertions
- 完整 contract matrix 与七文件 scope 复验通过，无剩余 Critical、Important 或 Minor finding

### Code Quality Review

- final verdict: APPROVED
- 初审发现第二个 consumer 注册失败时已注册 background consumer 未回滚一项 Important
- correction 后正常 rollback 与 `offWork` failure 均保留原始 startup error，并确保后续重复 `stop()` 幂等
- transaction、claim/attempt/evidence revalidation、lease recovery、late fencing、fallback、配置与敏感信息隔离无剩余 finding

### Controller Verification

- `npm run verify:controller` 通过
- legacy 112/112
- new 291 passed with 1 configured smoke skipped
- integration 260/260
- workspace 5/5、contracts 7/7、project source 42/42、manifest、lint、typecheck、legacy build 均通过
- `npm run test:phase1:e2e` 通过 2/2
- `npm run test:phase2:e2e` 通过 6/6
- `npm run typecheck:phase2` 通过
- `npm run build -w apps/web` 通过
- `git diff --check` 通过

### Scope And Recovery Audit

- implementation diff 仅包含五个批准 Worker 文件、一个直接 Worker integration test 与 Phase 1 controlled Worker harness wiring
- 未修改 jobs boss、outbox dispatcher、database、migration、Query repository、API、public contracts、Web、Dify、dependency、lockfile、security policy 或 Gate
- retry 和 recovery 复用同一 evidence snapshot，duplicate wake 与 exact outbox replay 只产生一个 encrypted answer、一个 attempt、一个 completed terminal event 和一次 summary invocation
- lease authority 丢失会返回真实 `already-completed` 或 `terminal-noop`，迟到 Worker 不提交第二份结果
- dual-consumer partial startup failure 会先回滚已注册 consumer，再停止 boss，后续 shutdown 保持幂等

## Accepted Result

PHASE3-TASK5 implementation accepted at `dcc3b679d12a07d11aa534fa4f81396f18f8aaa9` and may proceed to PR and CI verification under DEC-0002

Task 6 remains locked until the implementation PR is merged, a merged checkpoint is accepted and the project source names the new main SHA
