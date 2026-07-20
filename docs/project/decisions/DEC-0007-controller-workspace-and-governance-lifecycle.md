---
decision_id: DEC-0007
status: accepted
recorded_at: 2026-07-20T13:25:28+08:00
confidence: high
scope: controller-workspace-and-governance-lifecycle
supersedes: none
---

# Controller Workspace And Governance Lifecycle

## Context

Phase 1 与 Phase 2 累积出 47 个 Git worktree、58 个本地分支、约 4.2 GB `.worktrees`、23 份独立 `node_modules`，主工作区 lint 因递归扫描历史 worktree 超过 4 GB heap 后 OOM

Task 4 还因直接测试、migration registry 与 runtime wiring 未列入逐文件 scope 而产生两次机械性 correction，说明现有高风险治理边界有效，但隔离资源和低风险配套文件缺少生命周期规则

## Decision

### Worktree 生命周期

- 每个 active task 原则上只保留一个实现 worktree，默认创建到 `~/.config/codex/worktrees/Novel-Analysis/`
- 临时治理、审查和 post-merge worktree 在对应 PR 合并后立即删除
- merged checkpoint 完成后删除该任务全部已合并 worktree与本地分支
- 删除前必须确认 worktree clean、HEAD 已进入 `main`、分支已推送且 PR 已合并
- 任何 dirty、未推送、未合并或证据冲突项必须保留并停止，不得强制删除
- 阶段结束执行 `git worktree prune`

### Task Contract 与治理节点

- Task Contract 改为 `core allowed modules`、`mechanical adjacent scope`、`prohibited changes`、`required behavior`、`required verification` 与 `escalation conditions`
- mechanical adjacent scope 默认包含直接对应测试、类型与导出入口、migration registry、既有模块 runtime wiring，以及新增 migration 必须更新的 schema roundtrip test
- mechanical adjacent change 必须与已批准行为存在直接因果关系，不得引入新模块、新业务语义或扩大用户可见能力
- 常规 task 原则上最多三个治理节点：Started Contract、Implementation Acceptance、Merged Checkpoint 与下一任务 Started Contract 的组合记录
- 直接测试、package export、migration registry、类型导出和既有模块 wiring 不再单独建立 correction PR
- 架构、数据模型或 migration 策略、安全、权限、凭证、阶段 Gate、验收标准、正式数据、部署、切换与不可逆操作仍必须单独暂停确认

### 验证职责

- 实现 Agent 默认执行 RED/GREEN、focused tests、lint、typecheck 与 scope audit
- 规格审查默认验证契约矩阵、focused tests 与遗漏行为
- 质量审查默认执行 targeted reproduction，并检查并发与错误路径
- 总控合并前执行完整 new、legacy、integration 与 project source 验证
- CI 执行仓库标准完整验证
- post-merge 默认只执行 focused smoke、project source、主线 SHA 与 clean 状态检查
- 修改共享基础设施、数据库 transaction、lease、outbox、安全或身份链路，或审查与 CI 出现全局风险或证据冲突时，扩大复验范围

### 工作区扫描与 Finder 元数据

- ESLint 显式忽略 `.worktrees/**`，未来任何仓库内临时 worktree 都不得进入 lint scope
- 当前 build 与 test 脚本没有等价的递归仓库扫描入口，后续新增此类入口必须显式排除 worktree
- `.DS_Store` 已确认仅为 Apple Finder 元数据，继续由 `.gitignore` 忽略，并从 Git 索引移除但不删除本机文件
- 主工作区除明确用户修改外必须保持 clean

### 项目信源精简

- 原则批准在 Phase 2 Gate 前将已完成任务移入 Phase 1 与 Phase 2 ledger
- accepted checkpoint 与 decision 原文件保持不可变，`PROJECT.md` 继续作为当前状态入口并通过链接引用 ledger
- ledger 改造不阻塞 Task 5，必须单独实施并通过项目源完整性测试

## Evidence

- 清理前只读盘点确认 46 个附加 worktree 全部 clean，所有 HEAD 均为 `main` 祖先，对应 PR 均为 MERGED
- 清理后只剩主工作区一个 worktree与本地 `main` 分支，仓库内 `.worktrees` 为 0 B，独立 `node_modules` 为 0
- `.DS_Store` 的文件类型为 `Apple Desktop Services Store`，仓库 `.gitignore` 已包含该路径
- `eslint.config.js` 原全局 ignore 未包含 `.worktrees/**`，而 `npm run lint` 使用 `eslint .`
- 当前 test、build 与 typecheck 命令使用明确配置或源码入口，没有发现与 `eslint .` 等价的递归 worktree 扫描
- 用户提供治理优化 Brief，并明确建议接受 DEC-A、DEC-C、DEC-D、DEC-E、DEC-F，确认后实施 DEC-B，原则接受并延后 DEC-G

## Consequences

- Task 5 起使用模块边界 contract、mechanical adjacent scope、分层验证和最多三个常规治理节点
- worktree 清理属于本地生命周期操作，不删除远端分支、Git 历史、checkpoint 或 decision
- 高风险确认边界不因机械 scope 自主权而放宽
- Phase 2 Gate 前仍需单独执行 ledger、依赖审计和 GitHub Actions SHA 固定风险处理

## Source

本决策来源于用户的主控工作区与治理流程优化 Brief、总控只读盘点和清理后的可验证结果
