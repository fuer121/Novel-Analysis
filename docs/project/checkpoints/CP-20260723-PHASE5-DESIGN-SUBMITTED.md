---
checkpoint_id: CP-20260723-PHASE5-DESIGN-SUBMITTED
task_id: PHASE5-PLAN
status: submitted
recorded_at: 2026-07-23T09:04:15+08:00
branch: codex/phase5-design
base_commit: fd0702e917ed08778898cc0fbb7cf1442576daf7
head_commit: fd0702e917ed08778898cc0fbb7cf1442576daf7
supersedes: none
---

# Phase 5 Design Submitted

## Scope

提交 Phase 5 迁移、性能、UAT 与切换设计，等待用户对书面设计的最终复核

本 checkpoint 不接受 Phase 5 实施计划，不解锁编码、正式快照访问、旧密钥使用、飞书配置、UAT、部署或切换

## Evidence

- 用户确认 Phase 5 交付生产规模演练、性能验证、UAT 方案与切换手册，不在当前阶段操作正式环境
- 用户确认只迁移书籍与章节，旧 L1、L2、Prompt 与 Analysis 不迁移并在新系统重建
- 用户确认书籍与章节迁移、硬校验、基础 smoke 和入口切换使用两小时窗口，L1/L2 重建允许超过两小时
- 用户确认切换后先开放书库与章节，分析能力按书籍重建完成情况逐步开放
- 用户确认使用单台固定服务器，切换后不恢复旧入口，旧备份保留 90 天
- 用户确认演练使用正式 SQLite 只读快照，UAT 由 3 至 5 名代表用户使用正式飞书应用完成
- 用户逐节确认迁移安全、重建、性能、UAT、部署、切换、Gate 和停止条件

## Scope Deviation

本设计拟在书面复核通过后取代既有总体设计中完整迁移 L1/L2/Prompt/旧 Analysis 和观察期旧入口回退规则

该变化由用户明确选择，尚未在本 submitted checkpoint 中标记为 accepted

## Accepted Result

设计文档可进入书面复核，复核通过后才可使用 `writing-plans` 形成 6 至 8 项实施计划
