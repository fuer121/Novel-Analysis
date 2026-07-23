---
decision_id: DEC-0017
status: accepted
recorded_at: 2026-07-23T09:28:49+08:00
confidence: high
scope: phase5-migration-and-cutover
supersedes: none
---

# Phase 5 Selective Migration And No Entry Rollback

## Context

既有总体设计要求迁移书籍、章节、L1、L2、索引组、Prompt 和旧 Analysis，并允许在两小时观察期内恢复旧入口

Phase 5 设计复核期间，用户明确选择只迁移书籍与章节，其他分析数据在新系统从零生成，同时选择正式切换后不恢复旧入口

用户进一步确认两小时维护窗口只约束书籍与章节迁移、硬校验、基础 smoke 和入口切换，L1/L2 全量重建允许超过两小时

## Decision

- SQLite 迁移范围只包含书籍、来源信息与章节
- 旧 L1、L2、索引组、Prompt、Analysis、任务、会话与运行状态不迁移
- 新系统使用仓库当前已批准 Prompt、Schema 与 Dify DSL 从零重建 L1/L2
- 切换后先开放书库和章节浏览，L2 提问与依赖索引的高级分析按书籍重建完成情况逐步开放
- 书籍与章节迁移、硬校验、基础 smoke 和入口切换必须在两小时内完成，L1/L2 全量重建不受该时限约束
- 正式切换前硬失败或超时必须取消切换并保持旧系统
- 正式切换完成后不恢复旧入口，严重故障进入新系统维护模式修复
- 旧 SQLite、密钥和配置保留 90 天，到期销毁必须单独审批并留存证据
- 正式快照、旧密钥、飞书回调、UAT、部署与切换继续使用独立 Gate，本决策不授权执行这些操作

## Consequences

- 新系统不提供旧 L1、L2、Prompt 或 Analysis 历史，相关能力必须等待对应书籍重建完成
- Phase 5 不需要建立旧分析兼容导入或长期双系统维护
- UI 与 API 必须 fail-closed，未完成重建的书籍不能错误开放分析能力
- 正式切换 Gate 必须验证新系统维护与恢复手册、观察期值守和不可变旧备份
- 本决策经 accepted checkpoint 生效后，取代总体设计第 17.1、17.3、17.4、19.1 和 21 节中的冲突规则，其余总体设计继续有效

## Source

用户于 2026-07-23 逐节确认 Phase 5 书面设计，并在书面设计提交后明确回复“确认”

