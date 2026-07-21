---
checkpoint_id: CP-20260721-PHASE3-TASK6-API-CORRECTION-ACCEPTED
task_id: PHASE3-TASK6-API-CORRECTION
status: accepted
recorded_at: 2026-07-21T17:40:34+08:00
branch: codex/phase3-task6-api-correction
base_commit: 05abfb31ecbc04aa351aabc613635ec634170842
head_commit: 9ebb7214a54de3be3de22c76ea80a3edac78eac5
supersedes: none
---

# Phase 3 Task 6 API Correction Accepted

## Scope

接受授权的 Query turn history 分页读取与安全 Trace 投影，为 Task 6 刷新恢复、连续对话和执行 Trace 提供最小读契约

实际 scope 为 contracts、Query repository、Query routes 三组核心文件与 `packages/database/src/index.ts` 类型导出，共七个授权文件

## Evidence

### Implementation Agent

- RED：contract schema 10 项、repository `listTurns` 2 项、route endpoint 2 项按预期失败
- 初始实现提交 `f09fa13ab2d21e7be305e9c2deb8f59be93fc682`
- legacy snapshot normalization 修复提交 `9ebb7214a54de3be3de22c76ea80a3edac78eac5`
- focused contracts 17/17、repository 17/17、routes 9/9
- full contracts 89/89、integration 267/267、Phase 1 2/2、Phase 2 6/6、typecheck、lint 和 diff check 通过

### Specification Review

- final verdict: APPROVED
- bounded opaque cursor、stable newest-first tie-breaker、history/detail split、authorization、archived read 与 strict Trace allowlist 均符合契约
- `packages/database/src/index.ts` 仅导出 `QueryTurnPage` 类型，属于 mechanical adjacent scope
- 无 schema、migration、write path、Worker、Web、dependency 或 lockfile 变化

### Code Quality And Security Review

- final verdict: APPROVED
- 初审发现旧 snapshot 的空白/超长字段会导致 public schema 失败并返回 500 一项 Important，已通过投影 trim、filter、slice 与安全降级修复
- listTurns revoke-wins race 已增加直接回归，撤权锁完成后读取被拒绝
- malformed/cross-session/cross-book cursor、same-time tie、limit boundary、private/team/admin、archived 与 sensitive sentinel 均通过定向复现
- history 不读取 evidence，无 N+1；detail 继续在既有授权边界返回 evidence
- 无剩余 Critical、Important 或 Minor finding

### Controller Verification

- `npm run verify:controller` 通过
- legacy 112/112
- new 301 passed with 1 configured smoke skipped
- integration 267/267
- workspace 5/5、contracts 7/7、project source 42/42、manifest、lint、typecheck 和 legacy build 均通过
- `npm run test:phase1:e2e` 通过 2/2
- `npm run test:phase2:e2e` 通过 6/6

### Scope And Security Audit

- history 仅返回 conversation fields 与 allowlisted Trace，不返回 evidence body、raw snapshot 或内部 identifiers
- detail 保留 evidence 并使用同一 Trace projector
- Trace 不暴露 execution signature、question HMAC、evidence hash、job/attempt、provider error 或 credential
- 未修改存储快照、加密、session visibility、write/fallback、lease、outbox 或 Worker 语义
- 标准 integration 曾出现既有跨文件并发波动；总控隔离的两文件 31/31、串行 full 265/265、后续标准 full 265/265 与当前标准 full 267/267 均通过，保留为非阻塞测试基础设施风险

## Accepted Result

PHASE3-TASK6-API-CORRECTION implementation accepted at `9ebb7214a54de3be3de22c76ea80a3edac78eac5` and may proceed to PR and CI under DEC-0002

PHASE3-TASK6 remains paused until this correction is merged and the project source records the new main SHA
