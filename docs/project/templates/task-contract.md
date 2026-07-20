---
task_id: TASK-ID
status: ready
base_commit: 0000000000000000000000000000000000000000
owner: replace-with-agent
---

# Task Contract Template

> **启动门禁：所有占位值必须替换，且项目 `baseline_status` 必须为 `current` 后才能启动任务**

## Core Allowed Modules

- 待填写：本任务可修改的核心模块边界

## Mechanical Adjacent Scope

- 直接对应测试
- 类型与导出入口
- migration registry
- 既有模块 runtime wiring
- 新增 migration 必须更新的 schema roundtrip test

以上变更必须与已批准行为存在直接因果关系，不得引入新模块、新业务语义或新的用户可见能力

## Base Commit

`0000000000000000000000000000000000000000`

## Success Criteria

- 待填写：可验证的行为和完成标准

## Prohibited Changes

- 待填写：明确禁止的范围、行为和文件类型

## Required Verification

- 实现 Agent：RED/GREEN、task-specific focused tests、`npm run verify:implementation`、scope audit
- 总控合并前：`npm run verify:controller`
- Post-merge：task-specific focused smoke、`npm run verify:post-merge`、主线 SHA 与 clean 状态
- 待填写：本任务额外要求的验证命令和证据

## Escalation Conditions

- 新数据对象或表
- 新外部依赖
- 新认证、权限或凭证语义
- 新 API 产品能力
- Gate、验收标准或任务顺序变化
- 正式数据、部署、线上切换或不可逆操作
- baseline 状态为 `stale`、`conflicted` 或 `blocked`

## Resource Budget

- 一个实现 worktree
- 常规治理节点最多三个：Started Contract、Implementation Acceptance、Merged Checkpoint
