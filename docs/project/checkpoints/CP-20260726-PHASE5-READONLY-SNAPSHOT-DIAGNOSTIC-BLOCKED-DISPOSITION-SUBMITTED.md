---
checkpoint_id: CP-20260726-PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-BLOCKED-DISPOSITION-SUBMITTED
task_id: PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-BLOCKED-DISPOSITION
status: submitted
recorded_at: 2026-07-26T17:35:01+08:00
branch: codex/phase5-readonly-snapshot-diagnostic-blocked-disposition
base_commit: 93e28562781f21cb8d5bf355f448283e58fa3ad5
head_commit: 93e28562781f21cb8d5bf355f448283e58fa3ad5
supersedes: none
---

# Phase 5 Read-Only Snapshot Diagnostic Blocked Disposition Submitted

## Scope

提交read-only snapshot diagnostic在candidate启动前BLOCKED后的处置方案

本Gate只请求授权一个repository-external、synthetic-only的controller protocol correction任务，用于修正accepted candidate调用入口、raw evidence custody与完整fresh-absence证明

本Gate不授权读取真实config、snapshot、old key或Keychain，不生成target keys，不连接Docker或database，不修改accepted candidate，也不授权任何真实diagnostic或retry

## Recommended Disposition

采用最小protocol修正并保持accepted candidate字节、owner-only权限、diagnostic语义与fail-closed边界不变

- Controller不得直接执行owner-owned `0600` candidate member
- Controller只允许使用`execution.json`冻结的accepted Perl调用accepted `bootstrap.pl` entry
- `bootstrap.pl`继续按accepted candidate既有链路调用`wrapper.sh`，不得由repository-external helper替代或绕过
- Candidate root继续为owner-owned `0700`，8个members继续为owner-owned `0600`且无symlink，不得通过`chmod +x`修正
- Private stdout、stderr与diagnostic sinks必须保留到规格与质量reviewer都完成pre-cleanup直接核验
- Pre-cleanup双审完成后立即销毁raw sinks，再由两位reviewer完成post-cleanup fresh-absence核验
- Raw evidence custody最长不超过attempt结束后24小时；若期限前无法完成pre-cleanup双审，则销毁raw evidence并保持结果`BLOCKED`
- Fresh absence必须分别证明process、file、key、local TCP与task-owned runtime五个维度，不得以task temp或worktree absence替代其他维度

## Task Contract

- Task ID：`PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-CONTROLLER-PROTOCOL-CORRECTION`
- Core allowed modules：accepted repository-external 8-member candidate bundle的只读调用、synthetic controller invocation、raw evidence custody、review handoff与fresh-absence protocol
- Mechanical adjacent scope：candidate synthetic copy、fake config与snapshot fixture、focused tests、sanitized evidence schema、SHA-256 inventory与cleanup proof
- Base commit：`93e28562781f21cb8d5bf355f448283e58fa3ad5`
- Base identity：`CP-20260726-PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-BLOCKED`记录的accepted 8-member candidate、review manifest、V3 config identity、repository anchor与stage identity
- Success criteria：synthetic unit经accepted Perl进入`bootstrap.pl`且不直接执行`0600` member，ordinary stdout/stderr为零，raw sinks完成pre-cleanup双审后才销毁，process、file、key、local TCP与task-owned runtime fresh absence均由post-cleanup双审独立验证
- Prohibited changes：真实输入或runtime访问、accepted candidate或权限修改、diagnostic allowlist修改、snapshot写入或修复、key访问、Docker、database、migration、capacity、Dify、飞书、部署、切换、cutover或retry
- Required verification：TDD RED/GREEN、完整synthetic protocol unit、direct-exec `126` reproduction、accepted Perl bootstrap invocation、ordinary-output zero scan、raw retention state transition、24小时deadline模拟、五维fresh-absence、interruption cleanup、sensitive-data scan、独立规格与质量双审
- Escalation conditions：任一真实输入需求、candidate或Gate语义变化、raw evidence越权或超期、fresh-absence维度缺失、Critical、Important、阻塞finding或证据冲突必须停止

## Corrected Protocol Boundary

Synthetic correction必须证明以下顺序且不得拆分

1. 只使用synthetic fixtures fresh验证accepted invocation shape、owner、mode、type、containment、tool identity与candidate identity
2. 预创建owner-only private stdout、stderr与diagnostic sinks，并记录task-scoped process、file、key、local TCP与runtime absence基线
3. 由accepted Perl调用accepted `bootstrap.pl`，不得直接执行`bootstrap.pl`、`wrapper.sh`或其他`0600` member
4. 验证bootstrap-owned wrapper链、exit status、allowlisted diagnostic与ordinary-output zero contract
5. Attempt结束后保持raw sinks只读且owner-only，由规格与质量reviewer分别直接核验raw stderr是否为零、是否含真实路径或其他禁止输出，并核验完整diagnostic chain
6. 两项pre-cleanup review均完成后立即销毁raw sinks与临时执行引用
7. 两位reviewer分别验证process、file、key、local TCP与task-owned runtime fresh absence，再完成最终review verdict
8. 任一pre-cleanup review未在24小时上限前完成时销毁raw sinks、记录`BLOCKED`并禁止用sanitized摘要或推断替代raw核验

Synthetic correction通过双审后只能提交一个新的named read-only snapshot diagnostic Gate供用户决定，不得自动使用真实config或snapshot

## Prohibited Changes

- 读取、复制、打开、hash或修改真实config、snapshot、old key、Keychain、target key、plaintext sentinel或credential
- 连接Docker daemon、PostgreSQL、Dify、飞书、部署或正式环境
- 修改accepted candidate、8-member permissions、catalog、detached digest、review manifest、repository anchor、stage artifact或V3 config
- 修改snapshot-preflight reason allowlist、调用次数、fail-closed规则、Gate顺序或验收标准
- 通过`chmod +x`、直接执行`0600` member、shell fallback、临时helper或手工补跑绕过accepted bootstrap链
- 将raw evidence、真实路径、fingerprint、credential、key、database URL、plaintext或动态异常写入Git、CI、ordinary terminal、ordinary logs或sanitized result
- 执行真实preflight、snapshot-preflight、full execute、migration、capacity或任何retry
- 以本Gate接受替代后续synthetic correction acceptance或新的真实diagnostic Gate

## Required Reviews

- 规格审查必须建立contract matrix，证明accepted Perl → `bootstrap.pl` → `wrapper.sh`调用链、双阶段review与五维fresh-absence没有遗漏或扩大真实输入范围
- 质量审查必须targeted reproduce direct-exec exit `126`、ordinary stderr泄漏、pre-review deletion、24小时deadline、review interruption、缺失absence维度、伪造sanitized result与cleanup failure
- 两项review都必须在synthetic raw custody窗口内完成pre-cleanup核验，并在raw cleanup后完成fresh-absence核验
- 任一Critical、Important或阻塞finding未关闭时不得接受correction

## Acceptance Semantics

只有本submission PR合并后，用户明确回复`接受 GATE-PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-BLOCKED-DISPOSITION`才授权synthetic-only controller protocol correction

该接受不授权读取真实config或snapshot，不授权修改accepted candidate，也不授权read-only diagnostic retry

Synthetic correction完成TDD、冻结与独立双审后，总控只能提交新的named read-only diagnostic Gate供用户决定

## Evidence

- Read-only snapshot diagnostic唯一attempt在accepted wrapper启动前因direct execution of owner-owned `0600` member返回`126`
- Candidate preflight与snapshot-preflight调用次数均为零，snapshot、keys与runtime resources未访问
- Ordinary stdout为零但ordinary stderr非零，private diagnostic chain为`NONE`
- Raw stderr在独立review前销毁，无法排除真实wrapper路径或其他禁止输出
- Task temp与worktree absence已证明，但process、key、local TCP与task-owned runtime fresh absence证据不完整
- 规格审查为`SPEC_BLOCKED`，质量审查为`QUALITY_BLOCKED`，全部Critical与Important findings保持open
- 唯一diagnostic authorization已消耗且原Gate下禁止任何retry
- Main与origin/main在本submission开始前同步于`93e28562781f21cb8d5bf355f448283e58fa3ad5`且clean
- 本submission未读取真实config、snapshot、keys、Keychain、credential或任何runtime resource

## Decisions Required

本Gate submission合并后，用户需明确接受或拒绝`GATE-PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-BLOCKED-DISPOSITION`

## Recommended Next Action

先完成本submission PR的CI、合并与post-merge verification

用户明确接受后，再启动synthetic-only controller protocol correction、冻结与独立双审

## Acceptance Request

请求用户决定是否接受本处置方案

接受前synthetic correction、真实输入访问、read-only diagnostic retry、真实retry、飞书UAT、部署与切换全部保持locked
