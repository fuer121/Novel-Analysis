---
checkpoint_id: CP-20260726-PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-CONTROLLER-PROTOCOL-CORRECTION-BLOCKED-DISPOSITION-SUBMITTED
task_id: PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-CONTROLLER-PROTOCOL-CORRECTION-BLOCKED-DISPOSITION
status: submitted
recorded_at: 2026-07-26T19:28:41+08:00
branch: codex/phase5-readonly-snapshot-diagnostic-protocol-v2-disposition
base_commit: c6695f231eed627b12f4e0884cb76d75b44d2266
head_commit: c6695f231eed627b12f4e0884cb76d75b44d2266
supersedes: none
---

# Phase 5 Read-Only Snapshot Diagnostic Controller Protocol Correction Blocked Disposition Submitted

## Scope

提交controller protocol correction被独立规格与质量pre-cleanup双审判定`BLOCKED`后的处置方案

本Gate只请求授权一个新的repository-external、synthetic-only controller protocol correction V2，用于关闭raw evidence sealing、cleanup gate、diagnostic chain validation、五维fresh-absence、exception custody、reviewer independence与失败测试覆盖缺口

本Gate不授权读取真实config、snapshot、old key或Keychain，不生成target keys，不连接Docker或database，不修改accepted candidate，也不授权任何真实diagnostic或retry

## Custody Disposition

- 原synthetic attempt的三个raw sinks与child private reference已在24小时deadline前精确销毁
- Cleanup completion：`2026-07-26T19:26:49+08:00`
- Fresh file absence证明四个目标均不存在
- Sanitized attempt state、blocked checkpoint与frozen evidence继续保留
- 未把cleanup解释为correction通过，未启动post-cleanup五维review
- 未补跑synthetic attempt，未访问任何真实输入或runtime

## Recommended Disposition

放弃blocked 7-member protocol作为可接受controller identity，创建新的V2 identity并保持accepted 8-member candidate、owner-only权限、diagnostic语义与fail-closed边界不变

- Raw sinks在attempt结束并关闭descriptor后立即seal为owner-readable `0400`，同时把size、mode、owner与SHA-256写入atomic sanitized custody state
- 两位reviewer必须核验相同frozen manifest与相同raw digests，review前后digest任一变化立即`BLOCKED`
- Cleanup在deadline前只接受两项独立pre-cleanup review均为passed；deadline到达时无条件销毁raw evidence并保持`BLOCKED`
- Diagnostic validator必须使用accepted固定reason allowlist并验证status一致性、合法stage顺序、唯一性、完整chain与truncation拒绝
- Attempt启动前持久化task-owned process、file、key、local TCP与runtime baseline identities；cleanup后由controller-owned probes重新观测，不接受caller提供的布尔值
- Custody state必须在child invocation前atomic持久化不可延长的hard deadline；execution exception、controller restart与cleanup partial failure都必须可恢复且fail closed
- 两项review必须来自不同reviewer handoff identity，分别绑定role、frozen manifest digest、raw digests与review timestamp；相同reviewer identity不得登记两个role

## Task Contract

- Task ID：`PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-CONTROLLER-PROTOCOL-CORRECTION-V2`
- Core allowed modules：repository-external synthetic controller protocol V2、accepted candidate只读invocation、raw custody state、reviewer handoff、synthetic五维probe与cleanup state machine
- Mechanical adjacent scope：synthetic candidate copy、fake config与snapshot fixture、fixed diagnostic policy fixture、focused tests、sanitized evidence schema、SHA-256 inventory与cleanup proof
- Base commit：`c6695f231eed627b12f4e0884cb76d75b44d2266`
- Base identity：blocked correction checkpoint、accepted 8-member candidate、accepted diagnostic allowlist与repository anchor；旧7-member protocol只能作为blocked evidence，不得原地改写
- Success criteria：关闭全部7类consolidated findings，TDD与完整synthetic protocol unit通过，frozen V2 identity完成pre-cleanup双审、受控cleanup、五维post-cleanup双审且无Critical、Important或阻塞finding
- Prohibited changes：真实输入或runtime访问、accepted candidate或权限修改、diagnostic allowlist修改、snapshot写入或修复、key访问、Docker、database、migration、capacity、Dify、飞书、部署、切换、cutover或retry
- Required verification：RED/GREEN、raw seal与digest mutation、failed-review cleanup rejection、deadline cleanup、exact diagnostic allowlist与chain matrix、atomic state与resume、execution exception、review interruption、partial cleanup failure、distinct reviewer identity、五维fresh observation、sensitive-data scan、独立规格与质量双审
- Escalation conditions：任一真实输入需求、candidate或Gate语义变化、raw custody越权或超期、probe维度缺失、Critical、Important、阻塞finding或证据冲突必须停止

## Corrected Protocol Boundary

Synthetic correction V2必须证明以下顺序且不得拆分

1. 只使用synthetic fixtures fresh验证accepted invocation shape、owner、mode、type、containment、tool identity与candidate identity
2. 在child invocation前atomic记录task identities、五维baseline与不可延长的hard custody deadline
3. 预创建owner-only raw sinks，由accepted Perl调用accepted `bootstrap.pl`，不得直接执行任何`0600` member
4. Descriptor关闭后立即seal raw sinks为`0400`并atomic记录size、mode、owner与digest
5. 两个不同reviewer分别基于同一frozen identity与raw digests核验ordinary output、sensitive scan及完整allowlisted diagnostic chain
6. Deadline前只有两项review都passed才能cleanup；deadline到达时必须cleanup并保持`BLOCKED`
7. Cleanup逐目标记录结果，任一partial failure都保持`BLOCKED`并允许exact-target resumable cleanup
8. Raw与temporary execution references absent后才运行process、file、key、local TCP与task-owned runtime五个controller-owned fresh probes
9. 两位reviewer分别核验fresh observations后才能形成最终verdict

Synthetic correction V2通过双审后只能创建correction result checkpoint，不得自动提交或执行新的read-only snapshot diagnostic Gate

## Prohibited Changes

- 读取、复制、打开、hash或修改真实config、snapshot、old key、Keychain、target key、plaintext sentinel或credential
- 连接Docker daemon、PostgreSQL、Dify、飞书、部署或正式环境
- 修改accepted candidate、8-member permissions、catalog、detached digest、review manifest、repository anchor、stage artifact或V3 config
- 修改snapshot-preflight reason allowlist、调用次数、fail-closed规则、Gate顺序或验收标准
- 将raw evidence、真实路径、fingerprint、credential、key、database URL、plaintext或动态异常写入Git、CI、ordinary terminal、ordinary logs或sanitized result
- 执行真实preflight、snapshot-preflight、full execute、migration、capacity或任何retry
- 以本Gate接受替代V2 correction result acceptance或新的真实diagnostic Gate

## Required Reviews

- 规格审查必须建立contract matrix，覆盖raw sealing、passed-only cleanup、accepted diagnostic chain、hard deadline、atomic resume、distinct reviewer identity与五维fresh observation
- 质量审查必须targeted reproduce raw mutation、两个failed review、forged reason、illegal chain、execution exception、controller interruption、duplicate reviewer、stale boolean、partial cleanup failure与deadline cleanup
- 两项review必须由不同reviewer独立完成pre-cleanup与post-cleanup阶段，且分别绑定同一frozen identity和evidence digests
- 任一Critical、Important或阻塞finding未关闭时不得接受V2 correction

## Acceptance Semantics

只有本submission PR合并后，用户明确回复`接受 GATE-PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-CONTROLLER-PROTOCOL-CORRECTION-V2`才授权synthetic-only V2 correction

该接受不授权读取真实config或snapshot，不授权修改accepted candidate，不授权read-only diagnostic retry，也不授权新的真实diagnostic Gate

## Evidence

- Blocked correction的accepted baseline为`63/63 PASS`，focused protocol为`17/17 PASS`，synthetic attempt exit为`0`
- Accepted candidate exact 8-member identity与blocked frozen 7-member identity均已fresh匹配
- 独立规格审查为`SPEC_BLOCKED`并有4个Important，独立质量审查为`QUALITY_BLOCKED`并有6个Important
- Consolidated findings为raw writable、failed-review cleanup、diagnostic validation、五维baseline/probe、exception custody、reviewer independence与缺失失败测试
- Raw sinks与child private reference已在deadline前销毁，fresh file absence通过
- Main与origin/main在本submission开始前同步于`c6695f231eed627b12f4e0884cb76d75b44d2266`且clean
- 本submission未重跑synthetic attempt，未读取真实config、snapshot、keys、Keychain、credential或任何runtime resource

## Decisions Required

本Gate submission合并后，用户需明确接受或拒绝`GATE-PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-CONTROLLER-PROTOCOL-CORRECTION-V2`

## Recommended Next Action

先完成本submission PR的CI、合并与post-merge verification

用户明确接受后，再启动repository-external synthetic-only V2 correction、冻结与独立双审

## Acceptance Request

请求用户决定是否接受本处置方案

接受前V2 correction、真实输入访问、read-only diagnostic retry、真实retry、飞书UAT、部署与切换全部保持locked
