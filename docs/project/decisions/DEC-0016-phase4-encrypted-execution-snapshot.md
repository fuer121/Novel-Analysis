---
decision_id: DEC-0016
status: accepted
recorded_at: 2026-07-22T08:33:23+08:00
confidence: high
scope: phase4-advanced-analysis-execution-snapshot
supersedes: none
---

# Encrypted Advanced Analysis Execution Snapshot

## Context

PHASE4-TASK3 规格复审确认，现有 `analysis_runs` 只能保存不可逆 signature，L2 重建会删除旧 facts，因此 Task 4 无法恢复创建任务时的 L2 输入

同一复审确认，model、reasoning effort 与 executor version 没有已接受的权威运行配置，当前实现中的硬编码值不能代表真实可执行配置

用户在了解三种方案的实际使用差异后明确选择方案 A：每次创建分析任务时保存一份完整加密执行快照，旧任务继续使用创建时资料，不改变整个 L2 索引的覆盖更新策略

## Decision

- 为现有 `analysis_runs` 增加一组 all-or-none 的 execution snapshot ciphertext、nonce、auth tag 与 key version 字段，不新增第五张 analysis 表
- execution snapshot 使用既有 `ContentCipher` 加密并经 strict Zod schema 校验，禁止把解密内容复制到 Job、event、outbox、audit、日志或普通错误 JSON
- snapshot 冻结创建时的 selected chapter ID、order、content HMAC、source version、L1 input/version、L2 fact ID 与完整 fact payload、index group configuration、template version/content hash、workflow identity、model、reasoning effort、executor version、mode、range 与 scope hash
- Prompt、Schema 与章节正文继续只存在于既有加密内容边界，snapshot 不得保存章节明文
- preview 与 create 使用同一个 authoritative selection 和 execution configuration，scope hash 覆盖完整冻结输入，create 在同一 transaction 内重算并加密保存 snapshot
- model、reasoning effort 与 executor version 必须由显式 `AdvancedAnalysisExecutionConfig` 注入，测试显式提供 fixture，生产运行配置缺失时 fail-closed，不允许硬编码或静默默认
- Task 3 只创建并保存 snapshot，不执行分析，不读取 snapshot 驱动 Worker，不改变 Job lease、outbox 或状态机语义
- Task 4 只能使用 Task 3 保存的 snapshot 执行和恢复，不得重新查询 current L1/L2 facts 代替冻结输入
- 保持现有 L2 覆盖更新与数据保留策略，不引入全局索引版本库

## Consequences

- 已创建的高级分析任务在 L1/L2 重建后仍能使用创建时输入恢复，避免同一任务前后漂移
- Task 3 allowed scope 增加可逆 migration、database types/repository/roundtrip tests、strict snapshot contract 和 API runtime configuration wiring
- Task 4 必须验证 snapshot decrypt、attempt/lease authority、恢复与 late-attempt rejection，不能重新定义 snapshot 内容
- migration 只演进重构数据库结构，不执行正式数据迁移、部署或线上切换
- 本决策不新增表、不改变 L2 保留策略、不授权 Worker execution、正式数据、部署、UAT、cutover 或 Phase 4 Gate

## Source

用户于 2026-07-22 在 Task 3 规格 blocker 决策中明确选择方案 A
