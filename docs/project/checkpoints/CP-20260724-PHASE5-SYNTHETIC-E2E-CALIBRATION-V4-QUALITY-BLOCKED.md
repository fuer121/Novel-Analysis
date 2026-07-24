---
checkpoint_id: CP-20260724-PHASE5-SYNTHETIC-E2E-CALIBRATION-V4-QUALITY-BLOCKED
task_id: PHASE5-SYNTHETIC-E2E-CALIBRATION
status: accepted
recorded_at: 2026-07-24T17:30:00+08:00
branch: codex/phase5-synthetic-v4-calibration
base_commit: 0996b12df6612baab7538ab68b47d1087ed9bcf5
head_commit: 0996b12df6612baab7538ab68b47d1087ed9bcf5
supersedes: none
---

# Phase 5 Synthetic E2E Calibration V4 Quality Blocked

## Scope

按精简计划修正secret与path sentinel策略，固定execution bytes，完成bounded capacity preflight与一次full synthetic E2E，并依次执行独立spec与quality review

本checkpoint不授权真实retry，不访问production snapshot、old production key、Keychain、Dify或飞书，不创建真实演练数据库，不推进UAT、deployment、traffic switch或cutover

## Evidence

- Capacity preflight通过，browse p95 `301.421ms`、submit p95 `242.112ms`、status p95 `243.989ms`，priority检查均为true
- Full synthetic V4完成12/12场景，包含success、readiness retry、containment、helper load、fixture generation、database initialization、migration、capacity、publication及Docker各阶段失败清理
- Success browse p95 `324.310ms`、submit p95 `224.640ms`、status p95 `226.363ms`，均满足accepted阈值，priority检查均为true
- Migration CLI与capacity runner均执行成功，8/8 migration validations通过，success atomic publication为true
- 每场景与launcher outer stdout/stderr均为`0`字节
- Retained sentinel、tracked与untracked secret、base-relative path delta matches均为`0`
- Container、volume、network与run artifacts残留均为`0`
- Base与actual SHA均为`0996b12df6612baab7538ab68b47d1087ed9bcf5`且仓库clean

## Fixed Evidence Identity

- Exact bundle为8个文件，目录`0700`、文件`0600`、全部non-symlink
- Launcher SHA-256：`b3c703cca06308f206b07d21dbd32c401ae2bc6f2a15834ef56aa2f9421a4296`
- Wrapper SHA-256：`2d198506121f0625e2a35a662302257e152c0dd550e43cc9fd57125ca57dc7bd`
- Helper SHA-256：`a04ec64665cb33446d2a159c695e16b7dde931e797f7f24fd9fb8dc724861407`
- Catalog detached SHA-256：`e77b70e229252c53a53aa11e3d5ca62a9ebc7b3bb0dfaf66813bd899f7c382e5`

这些anchors仅标识本次blocked synthetic evidence，不是accepted real retry execution identity

## Independent Review

- Specification review：`SPEC_APPROVED — SYNTHETIC CALIBRATION V4 SATISFIES THE APPROVED CONTRACT; REAL RETRY AND ALL LATER GATES REMAIN LOCKED`
- Quality review：`QUALITY_BLOCKED`
- 控制shell在launcher完成后使用zsh只读变量`status`导致shell exit `1`，规格审查判定为Minor且非阻塞，该退出码不能用作launcher exit证据

## Quality Findings

1. Important：retained evidence扫描未携带每轮`snapshot_fingerprint`与`database_url`，运行时值若泄漏到evidence仍可能报告scan PASS
2. Important：launcher未读回并验证原始evidence manifest的digest sidecar，catalog只验证重新序列化后的副本，原子发布与证据哈希未形成完整闭环
3. Moderate：spawn异常或status缺失、损坏可能在统一清理前抛出，现有12场景未覆盖launcher编排层失败清理

## Verification

- Sentinel policy test：3/3通过
- Node与POSIX shell语法检查通过
- Scenario matrix：12/12通过
- Catalog内全部文件SHA-256与detached catalog digest独立复核通过
- Spec review无Critical、Important或阻塞性finding
- Quality review确认正向证据通过，但上述2个Important与1个Moderate未关闭

## Recommendation

`DO NOT AUTHORIZE REAL RETRY`

下一步只修正三个证据链缺口并增加launcher编排层失败测试，完成focused tests后冻结新的exact bytes，再决定是否授权新的单次synthetic E2E

真实retry、production snapshot、old production key、Keychain、Feishu UAT、deployment与cutover继续locked

## Accepted Result

接受V4 synthetic执行事实与quality blocked结果，不接受当前launcher、wrapper或helper作为真实retry execution identity
