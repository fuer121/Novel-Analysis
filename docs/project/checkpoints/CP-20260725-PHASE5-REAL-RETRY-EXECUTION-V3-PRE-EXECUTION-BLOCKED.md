---
checkpoint_id: CP-20260725-PHASE5-REAL-RETRY-EXECUTION-V3-PRE-EXECUTION-BLOCKED
task_id: PHASE5-REAL-RETRY-EXECUTION-V3
status: accepted
recorded_at: 2026-07-25T22:13:25+08:00
branch: codex/phase5-real-retry-v3-pre-execution-blocked
base_commit: a3237daa1b434c3af27bb0b857bb1e532f104bbe
head_commit: a3237daa1b434c3af27bb0b857bb1e532f104bbe
supersedes: none
---

# Phase 5 Real Retry Execution V3 Pre-Execution Blocked

## Scope

记录Execution V3 accepted Gate启动前静态可执行性核对发现的resource absence ordering blocker

本checkpoint只接受blocked事实，不撤销既有named confirmation，不启动或消耗唯一attempt，不授权修改Gate、candidate或config

## Blocking Finding

Accepted Gate required sequence第2步要求在snapshot与key access前验证private sinks与六个预期resource name absence

Frozen candidate直到full execute内部完成snapshot validation并读取old key、target keys与plaintext sentinel后，才由`randomBytes(16)`生成`runId`

Container与network名称依赖该`runId`，container-owned anonymous storage名称只在Docker创建container后返回，因此Gate第2步要求的六个resource identity在该时点尚不存在

Candidate没有独立resource-preflight mode，也不接受外部runId或预冻结resource names

继续执行只能跳过Gate第2步、增加未审查external checker、提前改candidate/config接口，或把resource absence移动到snapshot/key之后，均超出accepted Gate

## Attempt State

- Named Gate confirmation：accepted
- Attempt started：false
- Attempt consumed：false
- Candidate preflight：not run
- V3 config：not read
- Production snapshot bytes：not accessed
- Old key或Keychain：not accessed
- Target keys：not generated
- Docker daemon或PostgreSQL：not accessed
- Runtime、database、container、volume或network：not created

## Options

### Option A Recommended

修正Gate ordering以匹配accepted candidate

保留candidate snapshot-preflight先于任何key access，resource name absence由full execute在生成fresh random runId后、创建任何Docker resource前执行

该方案不改candidate、config、migration、Schema、threshold或cleanup semantics，但属于Gate ordering修正，必须重新提交并明确接受

### Option B

新增candidate-owned resource-preflight与稳定runId handoff

该方案需要修改candidate或config接口、重新完成synthetic suite、冻结与独立双审，复杂度和安全审查范围更高

### Rejected

不得增加repository-external临时checker、猜测anonymous storage名称、静默跳过Gate第2步或在未修正Gate的情况下启动attempt

## Evidence

- `entry.mjs`在snapshot validation与四类key/sentinel读取后才于line 695生成runId
- `resource-lifecycle.mjs`的container与network names由runId派生
- Anonymous storage name只存在于container inspect返回的Mounts记录
- Lifecycle在创建每个container/network前执行其fresh-name absence check，但该检查位于full execute内部
- Main与origin/main同步于`a3237daa1b434c3af27bb0b857bb1e532f104bbe`且clean
- 本核对只读取accepted repository与candidate source bytes

## Accepted Result

Execution V3在任何真实资源访问前BLOCKED，唯一attempt保持未开始且未消耗

等待用户选择Gate-only ordering correction或candidate interface correction

Dify、飞书、UAT、deployment、traffic switch与cutover继续locked
