---
checkpoint_id: CP-20260722-PHASE4-TASK5-ACCEPTED
task_id: PHASE4-TASK5
status: accepted
recorded_at: 2026-07-22T13:58:51+08:00
branch: codex/phase4-task5-legacy-history-api
base_commit: 91d2291456c75537bdedea01db0be284ad5d187e
head_commit: 44e199204682772b32c445c91f757b92fe9e9864
supersedes: none
---

# Phase 4 Task 5 Accepted

## Scope

接受 Phase 4 Legacy History GET-only 读取端口、owner 隔离路由、生产空 reader 与测试 fixture 注入

实际 scope 为四个 accepted API 文件，没有 SQLite、legacy runtime、migration、数据导入、写接口、依赖、Web、正式数据或部署变更

## Evidence

- `LegacyAnalysisReader` 仅包含 actor/book scoped list 与 actor/book/analysis scoped get，没有 create、update、delete、pause、resume 或 cancel 方法
- owner 可读取 list/detail，member 与 administrator 均在 reader 调用前返回 resource-not-found，未授权资源存在性不泄漏
- list 与 detail 输出均严格固定 `readOnly: true`、`canResume: false`，列表逐项绑定请求路径 book ID，跨书 reader 结果 fail-closed
- router 仅注册两条 GET，POST、PATCH、DELETE、pause、resume 与 cancel 六类路径均无 mutation handler
- production 默认使用冻结的 empty reader，不导入 fixture；fixture reader 仅显式注入并对存储和每次返回做 detached deep copy
- SQLite、`better-sqlite`、`server/workflows`、filesystem 与 legacy runtime 禁用依赖扫描无匹配
- 初始 RED 为 3 个 owner GET 404 失败；初始 GREEN focused integration 4/4
- 质量审查发现并修复 cross-book list exposure、mutable empty singleton 与 shared fixture reference，修复 RED 3 个预期失败，最终 focused integration 7/7
- 最终规格审查与质量审查在 `44e199204682772b32c445c91f757b92fe9e9864` 均 APPROVED，无未解决 finding
- 总控完整验证中 legacy 112、new 361 with 1 skipped、project source 42、workspace 5、lint、全 workspace typecheck、legacy build、Dify manifest 与 project check 通过
- 首次完整 integration 为 321/322，唯一失败是未修改的 index-groups 分页用例 `socket hang up`；该文件独立复跑 3/3，随后完整 integration 复跑 322/322，未复现
- `git diff --check`、四文件 scope audit、禁用依赖扫描与 clean worktree 通过
- PR #120 CI `verify` 通过

## Accepted Result

PHASE4-TASK5 实现已接受，可以合并 PR #120

本 checkpoint 不解锁 Task 6，Task 6 只在实现 PR merged checkpoint 合并后解锁

## Deferred Items

- book-scoped advanced analysis Web workspace 属于 Task 6
- production legacy data adapter 或正式数据导入属于 Phase 5
- 独立 Phase 4 验收、部署、UAT、切换与 Phase 4 Gate 仍保持锁定
