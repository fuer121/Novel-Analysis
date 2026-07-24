---
checkpoint_id: CP-20260724-PHASE5-REHEARSAL-PROTOCOL-CORRECTION-SUBMITTED
task_id: PHASE5-TARGET-SERVER-ISOLATED-REHEARSAL
status: submitted
recorded_at: 2026-07-24T09:29:00+08:00
branch: codex/phase5-rehearsal-protocol-correction
base_commit: ff570a40b22d3483a6c9b66b89d60cc6d69c1335
head_commit: ff570a40b22d3483a6c9b66b89d60cc6d69c1335
supersedes: none
---

# Phase 5 Rehearsal Protocol Correction Submitted

## Scope

提交target-server isolated rehearsal的private execution protocol修正与synthetic dry-run证据，请求重新解锁一次全新rehearsal run

本checkpoint不授权实际retry，不访问production snapshot、old production key、real Dify、Feishu、UAT、部署、流量或cutover

## Root Cause

前一次wrapper在shell noclobber启用后，对readiness stderr使用重复truncate redirection

第二次创建同一路径时shell在普通terminal报告`file exists`及private path，导致accepted Gate的path disclosure hard stop

该问题属于execution wrapper redirection defect，不涉及migration semantics、snapshot integrity、database schema或capacity thresholds

## Corrected Protocol

- 所有真实执行使用non-interactive Bash，启用`set -euo pipefail`、noclobber、`umask 077`、history disabled与command echo disabled
- 禁止使用Zsh特殊变量`path`或只读变量`status`，所有path变量使用`*_path`或`filepath`
- 每个stdout与stderr artifact在命令执行前只创建一次，确认private owner、non-symlink、`0600`与run-directory containment
- Readiness与其他retry loop只允许对已创建private log使用append redirection，禁止循环内truncate或重新创建同一路径
- Migration、capacity、database与cleanup child process的stdout和stderr全部重定向到private files
- Parent-owned Node launcher必须在Bash启动前以`wx`创建并验证private `0600` stdout与stderr sinks，再把file descriptors直接作为整个wrapper process的stdio
- Bash wrapper在parse、setup、expansion、redirection、child execution与cleanup阶段均不得继承ordinary terminal或controller session output
- Launcher自身不输出path、raw error或child content；wrapper failure只通过exit code和private launch result传播
- Controller只读取固定allowlist的脱敏PASS/FAIL、counts、thresholds与cleanup summaries，不读取或转发raw logs
- 任一process-launch sink缺失、path预存在、mode错误、realpath越界、stdio继承、cleanup失败或private value进入ordinary log时立即hard stop
- Actual retry必须使用与accepted synthetic evidence完全相同hash的launcher与protocol wrapper
- Private run manifest必须绑定launcher、wrapper、target script、canonical invocation、Bash version、exit codes与所有stdout/stderr hashes
- Launcher或wrapper任一byte变化时，旧confirmation立即失效，必须重新synthetic dry run并再次确认
- Actual retry必须使用全新run directory、全新ephemeral target keys和全新isolated databases，不复用blocked run或synthetic dry-run artifacts

## Synthetic Dry Run

Synthetic dry run仅使用一次性PostgreSQL 17 container、合成随机key与无敏感内容的synthetic command

验证结果

| Check | Result |
| --- | --- |
| Deterministic failed readiness probes | `2` |
| Total readiness attempts | `4` |
| Repeated append redirection under noclobber | `PASS` |
| Success wrapper stdout bytes | `0` |
| Success wrapper stderr bytes | `0` |
| Deterministic wrapper-level failure exit | non-zero |
| Failed wrapper stdout bytes | `0` |
| Failed wrapper stderr private capture | `PASS` |
| Private failure marker captured only in private sink | `PASS` |
| Parent-owned process-level stdio capture | `PASS` |
| Child stdout/stderr private redirection | `PASS` |
| Private file mode and containment | `PASS` |
| Exact launcher identity bound | `PASS` |
| Exact protocol wrapper identity bound | `PASS` |
| Canonical invocations and Bash version bound | `PASS` |
| Success and failure exit codes bound | `PASS` |
| All script、result与sink hashes bound | `PASS` |
| Atomic run manifest plus detached SHA-256 | `PASS` |
| Manifest hash verification | `PASS` |
| Synthetic key cleanup | `PASS` |
| Isolated container cleanup | `PASS` |
| Private path and production sentinel scan | `PASS` |
| Production snapshot access | `NOT RUN` |
| Production key access | `NOT RUN` |

## Private Evidence Custody

- V1 synthetic correction evidence因未覆盖process-level failure capture与identity binding而取消
- V1 evidence在v2开始后到达最早retention deadline，其private directory与全部files、logs、scripts、manifest及copies已由controller-agent销毁
- Controller fresh absence verification确认不存在v1 evidence directory或working copy
- V1 evidence不得用于本checkpoint接受、actual retry或任何later Gate
- Synthetic evidence由controller-agent作为唯一custodian保管
- Evidence不包含production data、credential、key material、snapshot fingerprint或真实target identity
- Retention deadline为本checkpoint接受或拒绝、correction取消、或2026-07-31T09:29:00+08:00中的最早时间
- 到期由controller-agent销毁private dry-run directory及全部copies并验证不存在
- Git只保留本checkpoint中的非敏感summary

## Required Execution After Acceptance

若本checkpoint被明确接受，Controller可创建一次全新private rehearsal run并按原accepted Gate执行

开始前必须重新hash launcher与protocol wrapper并与accepted private dry-run manifest逐byte匹配

Actual target script与canonical invocation必须在actual run manifest中独立绑定；它不得改变accepted Gate的commands、thresholds、migration scope或cleanup语义

执行顺序保持

1. Fresh snapshot retention、fingerprint与integrity preflight
2. Fresh old-key delivery与两份new ephemeral target keys
3. New isolated migration database seed verification
4. Existing migration CLI与全部8项hard validation
5. Key destruction
6. New separate synthetic capacity database与single-instance scale run
7. Secret scan、database cleanup、snapshot working access revocation与atomic run evidence

原Gate的threshold、hard stop、cleanup、retention与still-locked范围全部保持不变

## Decision Required

请明确接受或拒绝本protocol correction

接受只解锁一次全新isolated rehearsal retry，不解锁`GATE-PHASE5-FEISHU-UAT`或任何部署、切换及正式环境操作
