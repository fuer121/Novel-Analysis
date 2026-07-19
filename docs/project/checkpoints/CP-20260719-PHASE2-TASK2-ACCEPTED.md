---
checkpoint_id: CP-20260719-PHASE2-TASK2-ACCEPTED
task_id: PHASE2-TASK2
status: accepted
recorded_at: 2026-07-19T23:21:04+08:00
branch: refactor/phase2-task2-persistence
base_commit: 153f6464139d579b5835c5bc68658287a18cfeaf
head_commit: b9b0c9c6b6b53b9efcee152dc631312b446dd500
supersedes: none
---

# Phase 2 Task 2 Accepted

## Scope

接受 encrypted library and index persistence 实现，并允许实现 PR 在本治理记录先合并且 DEC-0002 条件满足后合并

本 checkpoint 不授权 API、Worker、jobs、Dify 调用、query、analysis、正式数据、部署、切换、Phase 2 Gate 变化或提前实施 Task 3

## Evidence

- 实现 SHA `b9b0c9c6b6b53b9efcee152dc631312b446dd500` 相对固定 base 为单提交，精确修改 13 个批准路径
- 原计划 12 个路径之外仅修改 `packages/database/src/schema.integration.test.ts`；用户明确授权修正新增 003 后的 003/002/001 migration roundtrip，未改变其他既有测试语义
- migration 003 创建批准的 10 个业务表及 FK、unique、check 和 coverage/review indexes，并可逐层回滚到空库再迁移到 latest
- 章节正文与 fact body 仅以 AES-256-GCM ciphertext、nonce、tag、key version 持久化；cipher 深度快照 key 配置，未知版本错误脱敏，错误 key/tag fail-closed
- L1 结果保留不可变历史，以 partial unique current projection 计算 coverage；替换锁定 chapter row，根连接并发和外层 transaction 提交/回滚均由真实 PostgreSQL 验证
- L2 composite FK 强制 group、chapter 同书，fact 必须引用同组 admitted subject
- fact metadata 使用严格非敏感 allowlist，额外自由文本与 sentinel 在加密和 SQL 前拒绝
- fact review limit 固定为整数 1..100，cursor、空页、末页和解密失败路径均 fail-closed
- PostgreSQL focused/schema 20/20、library contracts 8/8、new tests 200 passed 与 1 skipped、legacy 112/112 全部通过
- database/contracts typecheck、legacy lint/build、full lint、项目源 40/40、`project:check`、`git diff --check` 与 protected scope audit 通过
- 独立规格审查在修复 L1 历史、L2 integrity 和 transaction executor 后批准，无未解决 finding
- 独立质量审查在修复 cipher mutation、L1 concurrency、pagination 和 metadata bypass 后批准，无未解决 finding
- 未读取 Dify 凭证，未修改正式数据、线上 Workflow、API、Worker、jobs 或治理记录

## Accepted Result

Task 2 实现已接受。实现 PR 仍须 GitHub CI 成功且满足 DEC-0002 才能合并

## Remaining Risks

- UUID cursor 对应 fact 在翻页间被删除时会提前结束后续分页；Phase 2 当前没有 fact 删除路径，不阻塞 Task 2
- Fact category allowlist 在 contracts 与 database 分别维护，后续 category contract 演进必须同步验证
- 实现基线保持 `820b30a1cfae0b0a19be9fa763f44801742d38e9`，Task 2 合并不代表 Phase 2 最终验收
