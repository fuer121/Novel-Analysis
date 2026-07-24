---
checkpoint_id: CP-20260725-PHASE5-REAL-RETRY-IDENTITY-V2-INTERFACE-BLOCKED
task_id: PHASE5-REAL-RETRY-IDENTITY
status: accepted
recorded_at: 2026-07-25T01:27:18+08:00
branch: codex/phase5-identity-v2
base_commit: cab6a0a61276310cb4dfa8eb7556ae121356b1ed
head_commit: cab6a0a61276310cb4dfa8eb7556ae121356b1ed
supersedes: none
---

# Phase 5 Real Retry Identity V2 Interface Blocked

## Scope

记录new real retry identity candidate在freeze前发现accepted stage input与resource interface无法满足same-descriptor verified-use及resource binding contract

本checkpoint接受blocked事实，不接受candidate或任何entry SHA，不授权真实input、database或real retry

## Evidence

- Candidate开始前确认目标目录不存在，没有覆盖旧candidate
- RED因exact entry缺失按预期失败
- Focused pure与security contract已有23项assertion通过
- Migration result parser已绑定8项validation
- Capacity result parser已绑定strict browse、submit、status与两项priority contract
- PID、file absence与strict Docker parser和command construction通过
- Repository保持零修改且HEAD为`cab6a0a61276310cb4dfa8eb7556ae121356b1ed`
- 未访问production snapshot、old key、Keychain、database、Docker、network、Dify或飞书

## Blocking Findings

### Same Descriptor Verified Use

Accepted stage在`scripts/phase5-rehearsal-stage/src/stage.ts`中

- 使用`lstat(path)`检查private file后，再以独立`readFile(path)`读取request与database URL
- 检查source与key paths后，将paths交给migration CLI重新打开
- 不接受inherited descriptor或verified bytes作为input
- `/dev/fd/N`会被当前symlink检查拒绝

因此identity launcher即使先使用`O_NOFOLLOW` descriptor验证input，stage仍会按path重新读取，无法关闭same-owner swap与verified-use finding

### Resource Binding

- Accepted stage request与result没有launcher-bound opaque migration和capacity resource IDs
- Identity launcher无法把expected IDs与child result相互校验
- Launcher内置absence probes可以检查已知resource names，但无法证明stage实际使用的database resource与这些names一致

## Candidate Status

- Candidate未freeze
- Candidate没有accepted exact SHA、catalog或trust root
- Candidate不得进入spec或quality acceptance
- Candidate不得用于Execution confirmation或real retry

## Decision Required

### Option A1

最小修正accepted stage interface

- 支持inherited descriptor或verified bytes input
- Stage与migration path使用同一已验证input identity，或由stage在单一trusted custody内消费bytes
- Request与result绑定launcher提供的opaque migration和capacity resource IDs
- 保持migration、Schema、capacity与Gate语义不变

### Option A2

修订Gate并放宽same-descriptor verified-use与child resource-match要求，接受secure parent path custody与launcher-only absence probes

总控推荐Option A1

Option A1关闭根因并保持已确认的安全强度，Option A2会主动降低Gate安全边界

## Prohibited Changes Audit

- 未修改repository、stage artifact、dependency、migration、Schema、threshold或Gate
- 未读取或复制真实snapshot、key、credential或private evidence
- 未创建或访问真实database、Docker或外部system
- 未执行自动retry

## Accepted Result

接受identity v2在freeze前blocked的事实与停止建议

用户明确选择A1或A2前停止实现，Execution confirmation与真实输入继续locked
