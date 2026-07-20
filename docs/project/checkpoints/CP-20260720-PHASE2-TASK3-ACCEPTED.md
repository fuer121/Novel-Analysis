---
checkpoint_id: CP-20260720-PHASE2-TASK3-ACCEPTED
task_id: PHASE2-TASK3
status: accepted
recorded_at: 2026-07-20T08:40:21+08:00
branch: refactor/phase2-task3-import
base_commit: 1fa158bf39af1cfadc51517fbb0733c439e65628
head_commit: 9bd1bc4cb2c0bb16790de8d06f10ec93d41f3c38
supersedes: none
---

# Phase 2 Task 3 Accepted

## Scope

接受 Book Creation And Recoverable Chapter Import 实现，并允许实现 PR 在本治理记录先合并且 DEC-0002 条件满足后合并

本 checkpoint 不授权 L1 selector/executor/coverage、L2、Web、query、analysis、正式数据、部署、切换或提前实施 Task 4

## Evidence

- 实现 SHA `9bd1bc4cb2c0bb16790de8d06f10ec93d41f3c38` 相对固定 base 为单提交，精确修改 12 个批准路径
- 用户明确授权增加 `apps/worker/package.json` 与 `package-lock.json`；差异仅为 Worker 声明 `@novel-analysis/dify: "*"` 的两行 workspace dependency
- preview 与 create 共享 selector，稳定计算 requested/fresh/stale/executable 与 scopeHash；create 在 book lock 内重算，不一致零副作用返回 scope_changed
- import 幂等 key 按 route/book 命名空间，config snapshot 冻结 scopeHash、范围、source 和 autoStartL1；replay、active merge 与 unique 恢复均完整比较语义
- API 与 service 双层限制 Dify provider、安全整数、最大章节号 10000000 与最多 3000 章；拒绝发生在数组或 provider 调用前
- book/source 与 import job 使用分离显式事务；job、逐章 steps、created event、initial outbox 同事务创建
- Worker provider 调用在事务外，最终提交重验 claim/lease 并锁定同一 book；并发同章只有一个 chapter effect，迟到、取消与终态结果不覆盖
- provider、结构与配置失败原子写 attempt/step/job failed、progress 与脱敏事件，不留下 chapter row或无限 lease 重领
- stale chapter 保留原 ID 原位更新密文/HMAC/source，当前 L1 与相关 L2 status 变 stale，历史与 facts 保留
- autoStartL1 仅在完整成功或零执行完成时创建一次 queued handoff；部分失败、pause、cancel 与 recovery 不重复创建
- runtime config 支持全缺失兼容、完整有效、部分设置 fail-fast 三态，密钥长度与错误脱敏均有测试
- focused/Worker PostgreSQL 38/38、new 200 passed 与 1 skipped、legacy 112/112、项目源 40/40 全部通过
- Phase 1 typecheck、legacy lint/build、full lint、`project:check`、`git diff --check` 与 protected scope audit 通过
- 独立规格审查与独立质量审查在所有 Important 修复后批准，无未解决 finding
- 未读取 Dify 凭证，未修改 migration、Task 2 persistence、contracts、Workflow YAML、Web 或治理记录

## Accepted Result

Task 3 实现已接受。实现 PR 仍须 GitHub CI 成功且满足 DEC-0002 才能合并

## Remaining Risks

- queued L1 handoff 仅是 Task 3 明确信号，steps、outbox、selector 与 executor 由 Task 4 实现
- 23505 幂等恢复路径因 book lock 难以稳定制造真实竞争，但代码复用正常 replay 的完整语义比较
- 实现基线保持 `820b30a1cfae0b0a19be9fa763f44801742d38e9`，Task 3 合并不代表 Phase 2 最终验收
