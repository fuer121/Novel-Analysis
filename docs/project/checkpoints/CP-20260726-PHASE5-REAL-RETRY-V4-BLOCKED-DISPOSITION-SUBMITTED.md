---
checkpoint_id: CP-20260726-PHASE5-REAL-RETRY-V4-BLOCKED-DISPOSITION-SUBMITTED
task_id: PHASE5-REAL-RETRY-V4-BLOCKED-DISPOSITION
status: submitted
recorded_at: 2026-07-26T12:40:00+08:00
branch: codex/phase5-v4-blocked-disposition
base_commit: 6a16b9e131e4ba7d92522bc02b11c87bc6b2b166
head_commit: 6a16b9e131e4ba7d92522bc02b11c87bc6b2b166
supersedes: none
---

# Phase 5 Real Retry V4 Blocked Disposition Submitted

## Scope

提交V4 snapshot-preflight `UNKNOWN`盲区的处置方案

本Gate只请求授权一个repository-external、synthetic-only的诊断细化任务，不授权读取真实config、snapshot、old key或Keychain，不生成target keys，不连接Docker或database，也不授权任何真实retry

## Recommended Disposition

采用最小修正：保持现有执行语义和fail-closed行为，只将snapshot-preflight内部已知失败分支映射为固定、无动态内容的脱敏原因码

允许的固定原因类别仅包括

- Config identity或schema invalid
- Repository、stage或private-root identity changed
- Runtime path或resource pre-absence invalid
- Snapshot expired
- Snapshot fingerprint mismatch
- Snapshot sidecar invalid
- Snapshot SQLite integrity invalid
- Snapshot path、owner、mode、type、containment或stable-read invalid
- Unknown internal failure

原因码不得包含真实路径、文件名、credential、key、fingerprint、尺寸、时间、SQLite内容、exception message或任何动态字符串

## Task Contract

- Task ID：`PHASE5-SNAPSHOT-DIAGNOSTIC-REFINEMENT`
- Core allowed modules：repository-external candidate副本中的`entry.mjs`、`wrapper.sh`、`bootstrap.pl`、catalog与detached digest
- Mechanical adjacent scope：synthetic fixtures、focused suite、evidence manifest与SHA-256 inventory
- Base identity：V4 blocked attempt使用的8-member accepted candidate
- Required behavior：每个snapshot-preflight失败分支产生唯一固定reason，ordinary stdout/stderr保持为零，wrapper与bootstrap继续严格验证allowlist、链形、截断和status一致性
- Required verification：RED/GREEN、完整synthetic E2E、逐reason注入、未知错误归一化、泄漏扫描、cleanup absence、candidate refreeze、独立规格与质量双审

## Prohibited Changes

- 读取或复制真实config、snapshot、old key、Keychain、target key、plaintext sentinel或credential
- 连接Docker daemon、PostgreSQL、Dify、飞书、部署或正式环境
- 修改migration、Schema、capacity dataset、threshold、priority、Gate顺序或验收标准
- 修改repository stage artifact、database lifecycle、manifest publication或cleanup语义
- 将动态exception、路径、fingerprint或敏感值写入诊断
- 执行真实preflight、snapshot-preflight、full execute或任何retry
- 以本Gate接受替代后续真实诊断或retry的named Gate

## Required Reviews

- 规格审查必须证明每个允许原因与既有snapshot-preflight分支一一对应，没有遗漏或扩大产品语义
- 质量审查必须覆盖reason伪造、注入、截断、未知错误、child exit不一致、普通输出泄漏和synthetic cleanup
- 任一Critical、Important或阻塞finding未关闭时不得接受candidate

## Acceptance Semantics

只有本submission PR合并后，用户明确回复`接受 GATE-PHASE5-REAL-RETRY-V4-BLOCKED-DISPOSITION`才授权synthetic-only诊断细化任务

该接受不授权真实输入访问或retry

Synthetic candidate通过双审后，总控只能提交一个新的只读真实诊断Gate供用户决定；不得自动执行

## Evidence

- V4唯一attempt已在snapshot-preflight exit `70`后接受为BLOCKED
- Ordinary stdout与stderr均为零，私有诊断安全归一化为`UNKNOWN + ENTRY_EXIT`
- Attempt未进入key preparation、Docker、database、migration或capacity
- Runtime、process、Phase 5 container、network与anchor worktree fresh absence均通过
- V4结果独立规格与质量审查均APPROVED且无finding
- Main与origin/main同步于`6a16b9e131e4ba7d92522bc02b11c87bc6b2b166`且clean

## Decisions Required

本Gate submission合并后，用户需明确接受或拒绝`GATE-PHASE5-REAL-RETRY-V4-BLOCKED-DISPOSITION`

## Recommended Next Action

先完成本submission PR的CI与合并

用户明确接受后，再启动synthetic-only诊断细化、冻结与独立双审

## Acceptance Request

请求用户决定是否接受本处置方案

接受前真实输入、synthetic修正、retry、飞书UAT、部署与切换全部保持locked
