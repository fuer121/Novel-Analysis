---
checkpoint_id: CP-20260725-PHASE5-REAL-RETRY-CORRECTION-STARTED
task_id: PHASE5-REAL-RETRY-CORRECTION
status: accepted
recorded_at: 2026-07-25T17:30:00+08:00
branch: codex/phase5-real-retry-correction
base_commit: 6752edd91a99ad0e87da1fc838ebfca7507c6b59
head_commit: 6752edd91a99ad0e87da1fc838ebfca7507c6b59
supersedes: none
---

# Phase 5 Real Retry Correction Started

## Scope

实施[DEC-0027 Candidate Owned Preflight](../decisions/DEC-0027-phase5-candidate-owned-preflight.md)，将identity、tool、repository、stage与snapshot validation收回同一candidate，并完成synthetic refreeze与独立双审

## Task Contract

- Task ID：`PHASE5-REAL-RETRY-CORRECTION`
- Core allowed modules：repository外新candidate中的bootstrap、wrapper、entry preflight与snapshot validator
- Mechanical adjacent scope：直接synthetic tests、fixtures、identity library、resource lifecycle wiring、execution metadata、catalog、digest与sanitized review evidence
- Base commit：`6752edd91a99ad0e87da1fc838ebfca7507c6b59`
- Success criteria：candidate-owned preflight先于snapshot与key访问；snapshot validation先于key访问；large stage无`ENOBUFS`；full synthetic、leakage、cleanup、spec与quality review全部通过；最终bytes与SHA冻结
- Prohibited changes：product code、migration语义、database schema、capacity threshold、Gate顺序、验收标准、真实snapshot或key访问、Keychain、Docker、PostgreSQL、Dify、飞书、UAT、deployment、traffic switch、cutover与真实retry
- Required verification：RED/GREEN focused tests、candidate exact identity、full synthetic success/failure、ordering matrix、large-stage regression、ordinary output与Git sentinel scan、cleanup absence、scope audit、independent spec review与quality review
- Escalation conditions：新增外部依赖、新数据或安全语义、放宽任何Gate、无法保持单一candidate信任边界、发现Critical、Important或阻塞性finding、证据冲突或需要任何真实资源

## Authorization

用户明确选择方案A并授权synthetic correction

真实资源与任何retry继续locked，新的real retry必须等待本任务accepted后另行提交named Gate并获得明确确认

## Evidence

- Execution V2 blocked checkpoint已证明anchor与stage实际匹配，失败来自controller临时checker与错误ordering
- 用户明确选择方案A
- Correction开始时main为`6752edd91a99ad0e87da1fc838ebfca7507c6b59`

## Accepted Result

解锁`PHASE5-REAL-RETRY-CORRECTION`的repository-external synthetic implementation、冻结与独立双审

禁止访问任何真实资源或执行真实retry
