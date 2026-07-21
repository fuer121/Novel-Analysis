---
checkpoint_id: CP-20260721-PHASE3-TASK2-ACCEPTED
task_id: PHASE3-TASK2
status: accepted
recorded_at: 2026-07-21T10:43:14+08:00
branch: codex/phase3-task2-query-repository
base_commit: 31ad150cc4c7d3cd0068796e2ccf883fecbda99c
head_commit: d74b76ecd169776fe65ecaeef8d3cca053bf9f41
supersedes: none
---

# Phase 3 Task 2 Accepted

## Scope

接受三张 Query 表、可逆 migration、密文 repository、private/team 分享授权、权威 evidence snapshot 与单次终态提交边界

实际 implementation scope 严格限定为 Started Contract 批准的八个数据库文件，无 mechanical adjacent 文件扩张

## Evidence

### Implementation Agent

- 初始 RED：2 files failed，3 failed、11 passed，失败源为 Query repository、三张表、索引和 `analysis-summary` constraint 缺失，PostgreSQL 健康
- 初始实现提交 `b97db7655a7a5f07482d7116fe7767b730053d0a`
- plaintext 与 evidence immutability 修复提交 `c4d7ecae87d9066bf1b20b58faaa48ae107d5cf6`
- ordinary-column plaintext 修复提交 `342ce3e6ba51c905fef93d75ea4c39a22c639f5b`
- authoritative hash、authorization TOCTOU 与 terminal CAS 修复提交 `d74b76ecd169776fe65ecaeef8d3cca053bf9f41`
- 最终 focused integration 28/28，full integration 223/223，Phase 2 typecheck、lint 和 diff check 通过

### Specification Review

- final verdict: APPROVED
- 第一轮发现 arbitrary-key JSON plaintext 与 post-hash direct insert/concurrent commit 两项 Important，均已修复并复验
- 第二轮发现 ordinary text columns 可接收 plaintext 一项 Important，已增加 opaque hash、stable code、敏感值比较、DB constraint 和整行扫描
- 最终确认 Task 1 intent、source stats、recall/degradation code 与后续计划兼容
- 归档语义按已批准设计保持为禁止新 turn 但允许历史读取，不扩张为读取撤权

### Code Quality Review

- final verdict: APPROVED
- 初审发现 request-based evidence hash、authorization TOCTOU 和 terminal overwrite 三项 Important，均已关闭
- evidence hash 在 session/turn lock 下基于权威 persisted rows 的 canonical order 生成
- visibility revoke、create/get/commit/complete 和 session management 使用一致 transaction 与 lock order
- concurrent/stale completion 只能提交一个终态，existing attempt 必须一致
- caller-provided transaction 被复用，不发生嵌套并保持调用方原子性

### Controller Verification

- `npm run verify:controller` 通过
- legacy 112/112
- new 264 passed with 1 configured smoke skipped
- integration 223/223
- workspace 5/5、contracts 7/7、project source 42/42、manifest、lint、typecheck 和 legacy build 均通过
- `npm run test:phase1:e2e` 通过 2/2
- `npm run test:phase2:e2e` 通过 6/6
- `npm run typecheck:phase2` 通过
- `npm run build -w apps/web` 通过
- `git diff --check` 通过

### Scope And Security Audit

- implementation diff 仅包含八个批准的 `packages/database` 文件
- 未修改 API、jobs、Worker、Web、contracts、domain、Dify YAML/manifest、依赖、lockfile、凭证或治理记录
- 未新增第四张 Query 表、成员级 ACL、跨索引组能力、正式数据操作、部署或切换
- plaintext tests 覆盖 title、question、answer、fact body 在 JSON、ordinary columns、errors 和 joined raw rows 中的隔离

## Accepted Result

PHASE3-TASK2 implementation accepted at `d74b76ecd169776fe65ecaeef8d3cca053bf9f41` and may proceed to PR and CI verification under DEC-0002

Task 3 remains locked until the implementation PR is merged, a merged checkpoint is accepted and the project source names the new main SHA
