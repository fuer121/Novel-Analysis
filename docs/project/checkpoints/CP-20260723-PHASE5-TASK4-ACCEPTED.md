---
checkpoint_id: CP-20260723-PHASE5-TASK4-ACCEPTED
task_id: PHASE5-TASK4
status: accepted
recorded_at: 2026-07-23T13:59:55+08:00
branch: codex/phase5-task4
base_commit: c9d5663297c5c636d55385330068dfce5d718689
head_commit: d3eea9de6276a29b974c2e0d6c1074ae66767df8
supersedes: none
---

# Phase 5 Task 4 Accepted

## Scope

接受 strict analysis readiness contract、database-owned shared canonical freshness selector、existing-table readiness read model、server-side Query/Advanced locks 与 BookWorkspace fail-closed UI

实际 scope 包含 contracts、database、L1/L2 jobs mechanical selector wiring、books/query/advanced routes、BookWorkspace 与直接测试/exports/styles/package metadata；没有 table、migration、external dependency、scheduler、Prompt/Dify、Job persistence/lease/outbox/provider、auth/permission 或正式操作变化

## Accepted Behavior

- readiness 仅在 positive chapters、canonical current L1 与 active base-group L2 全部覆盖时 available
- stored `status=fresh` 仍必须匹配 current chapter source/HMAC、Prompt、workflow、schema/admission、group config 与 upstream L1 signature
- jobs 与 readiness 共用 database-owned selector，不存在第二套 freshness 公式
- any active L1 或 active relevant base-group L2 Job 均 fail closed，不被同类型/跨类型较新 terminal Job 掩盖
- active L1 优先，active base L2 次之；无 active 时 terminal failure/completed/cancelled按 deterministic ordering处理
- specialized group、other-book Job 不阻断 base analysis
- Query turn create 与 Advanced preview/create server-side re-read readiness并在未完成时返回 exact 409；read/history保持可用
- Web 仅在 explicit `analysisAvailable=true` 时解锁；pending/error/unavailable保持 visible、`aria-disabled`、禁止导航并显示稳定“索引重建中”进度槽

## Review And Corrections

- specification review发现 complete coverage 可掩盖 active/failed Job，且 Web pending/error fail-open；修复后 `SPEC_COMPLIANT`
- quality review发现 stored-fresh 未复用 canonical signatures、cross-type与same-type active Job masking
- 用户批准 DEC-0018 方案 A：`database -> domain` existing workspace dependency与 shared selector机械抽取
- canonical drift、cross-type masking与same-type L2 concurrency全部修复
- 最终 specification：`SPEC_COMPLIANT`，无 finding
- 最终 quality：`QUALITY_APPROVED`，无 finding

## Evidence

- readiness RED 最终累计覆盖 canonical drift与Job masking；GREEN 55/55
- L1/L2 jobs regression 5/5、3/3
- books/query/advanced API 15/15、10/10、4/4
- contracts 105/105、focused Web 54/54、schema roundtrip 15/15
- chapter、Prompt/workflow、group config、upstream L1 signature drift均锁定分析
- queued/running/retrying/paused × newer completed/cancelled/failed、concurrent base ranges、specialized group与cross-book矩阵通过
- dependency graph保持 acyclic `jobs -> database -> domain`
- 总控 `npm run verify:controller`：legacy 112、contracts 7、new 411 with 1 skipped、project source 42、workspace 5、PostgreSQL integration 426全部通过
- lint、typecheck、legacy build、Dify manifest、project source、diff-check、no-migration与scope audit通过

## Accepted Result

PHASE5-TASK4 实现已接受，可以创建 PR，等待 CI 后按既有授权合并

Task 5、正式 rebuild、snapshot、key、Feishu、UAT、deployment与cutover仍未解锁

## Deferred Items

- Phase 5 Tasks 5 至 8
- `GATE-PHASE5-TOOLS-ACCEPTED`
- 正式数据、部署、UAT 与切换
