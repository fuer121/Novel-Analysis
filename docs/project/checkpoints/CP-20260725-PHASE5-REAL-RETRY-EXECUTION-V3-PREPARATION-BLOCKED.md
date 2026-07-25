---
checkpoint_id: CP-20260725-PHASE5-REAL-RETRY-EXECUTION-V3-PREPARATION-BLOCKED
task_id: PHASE5-REAL-RETRY-EXECUTION-V3-PREPARATION
status: accepted
recorded_at: 2026-07-25T19:20:00+08:00
branch: codex/phase5-v3-gate-preparation-blocked
base_commit: d7c4697c3053311e0b1d4680ecfda2a2a7f1e267
head_commit: d7c4697c3053311e0b1d4680ecfda2a2a7f1e267
supersedes: CP-20260725-PHASE5-REAL-RETRY-CORRECTION-ACCEPTED
---

# Phase 5 Real Retry Execution V3 Preparation Blocked

## Scope

记录`GATE-PHASE5-REAL-RETRY-EXECUTION-V3`提交前冻结config时发现的完整执行单元ordering blocker

本checkpoint只接受blocked事实，不提交或确认Execution V3 Gate，不授权production snapshot、old key、Keychain、Docker、PostgreSQL或任何retry

## Preparation Result

- 经用户明确授权后只读取既有private snapshot access evidence的必要metadata字段
- 未打开、复制、重新hash、integrity check或解密production snapshot
- 未读取old key、Keychain或chapter plaintext，未生成target encryption key或HMAC key
- 未创建execution worktree、run root、input files、database、container、volume或network
- Repository-external V4 config已生成并冻结，SHA-256为`86e13aba6dc14bbb50cabe12a6070d344a5fa42e0437afe8090b3b538900096f`
- Config root为owner-only `0700`，config为owner-only `0600`且非symlink，真实路径、snapshot fingerprint与size未进入Git、CI或普通日志

## Blocking Finding

Accepted candidate的full execute在进程内部按identity、tool、repository、stage、snapshot validation、keys顺序读取

但full execute要求old key、target key、target HMAC key与plaintext sentinel文件在process启动前已经存在，controller必须在candidate执行前访问old key并生成target keys

因此完整执行单元的实际顺序仍会成为identity preflight、key preparation、full execute snapshot validation、key consumption，不满足既有Gate要求的snapshot validation先于old-key access与target-key generation

使用缺失key文件启动一次必失败execute来完成snapshot validation会消耗唯一attempt并违反hard-stop禁止自动retry要求，不可接受

## Options

### Option A Recommended

在同一candidate增加显式`snapshot-preflight`模式

该模式逐字节复用full execute的identity、tool、repository、stage、config SHA、snapshot deadline、metadata、fingerprint、sidecar、SQLite integrity与custody validation，但不要求或访问任何key文件

只有该模式PASS后controller才可访问old key并生成fresh target keys，随后full execute仍重新验证全部identity与snapshot，再读取keys

### Option B

让candidate在snapshot validation后直接负责Keychain old-key acquisition、target-key generation与private input lifecycle

该方案需要新增Keychain与credential acquisition安全语义、扩大candidate职责与审查范围，不符合当前最小复杂度原则

### Rejected

不得放宽为controller在snapshot validation前预先读取old key或生成target keys

不得用一次预期失败的真实execute充当snapshot preflight，也不得复用或自动retry已消耗attempt

## Evidence

- Frozen config只由accepted private metadata构造，创建过程输出仅包含permissions、deadline boolean与config SHA
- Candidate interface静态审计确认full execute前置文件要求与内部snapshot-before-key open顺序同时存在
- Production snapshot、old key、Keychain、Docker、database与network访问均为`NOT RUN`
- Main在准备开始时为`d7c4697c3053311e0b1d4680ecfda2a2a7f1e267`且clean

## Accepted Result

接受Execution V3 Gate preparation为`BLOCKED`，Gate未提交且没有真实attempt授权

建议选择Option A并完成新的synthetic correction、冻结与独立双审，全部真实资源继续locked
