---
checkpoint_id: CP-20260725-PHASE5-IDENTITY-V3-R1-RESTARTED
task_id: PHASE5-REAL-RETRY-IDENTITY
status: accepted
recorded_at: 2026-07-25T11:32:06+08:00
branch: unassigned
base_commit: 98a686e5179e005f2e49cfda4d4183cfcfb9b207
head_commit: 98a686e5179e005f2e49cfda4d4183cfcfb9b207
supersedes: none
---

# Phase 5 Identity V3 R1 Restarted

## Scope

实施[DEC-0024 Launcher Owned PostgreSQL Lifecycle](../decisions/DEC-0024-phase5-launcher-owned-postgres-lifecycle.md)，只在synthetic stub下关闭database resource ownership与cleanup blocker

## Task Contract

- Task ID：`PHASE5-REAL-RETRY-IDENTITY`
- Core allowed modules：repository-external `phase5-real-retry-identity-v3-draft`与新candidate
- Mechanical adjacent scope：repository-external focused tests、catalog、detached digest与minimal identity record
- Base commit：`98a686e5179e005f2e49cfda4d4183cfcfb9b207`
- Required lifecycle：launcher创建两套独立network、volume与container，使用固定image digest、random credential、loopback dynamic port与不可配置resource naming
- Required ownership：创建前absence；创建后绑定Docker immutable IDs与ownership labels；cleanup前重新匹配；mismatch不得删除
- Required custody：credential与database URL不得进入argv或ordinary output，只能通过private environment与inherited descriptor进入stage
- Required cleanup：spawn、timeout、malformed status、stage failure与publication failure均执行ownership-checked cleanup；cleanup与fresh absence完成前不得发布PASS
- Required identity：保持非循环bootstrap、same-fd bytes handoff、Git/stage/runtime anchors、strict allowlist、catalog与detached digest
- Required verification：RED/GREEN synthetic Docker stub、command exactness、inspect parser、collision、ownership mismatch、partial creation、cleanup ordering、fresh absence、sentinel、manifest provenance、full synthetic success/failure、独立spec与quality review
- Escalation：需要不同image、外部database URL、固定或非loopback port、config resource name、真实Docker或database、Gate/Schema/migration/capacity变化

## Prohibited Changes

- 连接Docker daemon、pull image、创建或删除真实container、volume、network或database
- Production snapshot、old key、Keychain、Dify、飞书、UAT、deployment、cutover或real retry
- 从config接受credential、database URL、host port或cleanup resource name
- 强制删除ownership mismatch resource
- 修改repository product code、migration、Schema、threshold、Gate顺序或accepted records

## Evidence

- 用户明确选择R1
- 当前`main`与`origin/main`同步且clean
- 旧candidate继续rejected，修正draft未freeze

## Accepted Result

解锁R1的synthetic stub implementation、candidate freeze与双审

Execution confirmation、真实input、Docker与real retry继续locked
