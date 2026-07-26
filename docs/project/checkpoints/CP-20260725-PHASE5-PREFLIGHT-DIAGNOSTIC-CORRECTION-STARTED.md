---
checkpoint_id: CP-20260725-PHASE5-PREFLIGHT-DIAGNOSTIC-CORRECTION-STARTED
task_id: PHASE5-PREFLIGHT-DIAGNOSTIC-CORRECTION
status: accepted
recorded_at: 2026-07-25T23:05:50+08:00
branch: codex/phase5-preflight-diagnostic-correction
base_commit: 776267c1d5c56a35c61753df7d7d1b43405e2f40
head_commit: 776267c1d5c56a35c61753df7d7d1b43405e2f40
supersedes: CP-20260725-PHASE5-REAL-RETRY-EXECUTION-V3-PREFLIGHT-BLOCKED
---

# Phase 5 Preflight Diagnostic Correction Started

## Scope

在全合成边界内为candidate preflight增加固定脱敏stage与reason code，关闭统一zero-output exit `70`无法归因的问题

## Task Contract

- Task ID：`PHASE5-PREFLIGHT-DIAGNOSTIC-CORRECTION`
- Core allowed modules：repository外新candidate副本中的`bootstrap.pl`、`wrapper.sh`与`entry.mjs`
- Mechanical adjacent scope：直接synthetic tests、fixtures、既有identity helper wiring、execution metadata、catalog、digest与sanitized review evidence
- Base commit：`776267c1d5c56a35c61753df7d7d1b43405e2f40`
- Success criteria：bootstrap、wrapper与entry的preflight失败产生固定且可判定的脱敏stage与reason code；ordinary stdout与stderr保持为零；完整synthetic失败矩阵、敏感信息扫描、cleanup absence、scope audit与独立双审全部通过；最终bytes与SHA-256重新冻结
- Prohibited changes：repository product code、migration语义、database schema、capacity threshold、Gate顺序、验收标准、accepted candidate原目录、真实config、production snapshot bytes、old key、Keychain、target key generation、Docker、PostgreSQL、Dify、飞书、UAT、deployment、traffic switch、cutover与任何真实retry
- Required verification：RED/GREEN focused tests、exact identity与tool failure、wrapper与entry load failure、repository与stage validation failure、deterministic sanitized code、zero ordinary output、private path与credential sentinel扫描、cleanup absence、full synthetic suite、scope audit、independent spec review与quality review
- Escalation conditions：新增外部依赖、新数据或安全语义、修改exit `70` fail-closed语义、放宽任何Gate、修改frozen config bytes、无法保持single candidate trust boundary、发现Critical、Important或阻塞性finding、证据冲突或需要任何真实资源

## Authorization

用户在Execution V3 blocked checkpoint后明确要求按压缩计划推进下一步，授权synthetic preflight diagnostic correction

任何真实input、runtime resource、真实retry与后续环境Gate继续locked

## Evidence

- Execution V3唯一attempt在candidate preflight以zero-output exit `70`结束，静态identity矩阵全部match但无法精确归因
- 项目源基线测试`42/42`通过
- `npm run project:check`通过
- 任务开始时main与origin/main同步于`776267c1d5c56a35c61753df7d7d1b43405e2f40`且clean

## Accepted Result

解锁`PHASE5-PREFLIGHT-DIAGNOSTIC-CORRECTION`的repository-external synthetic implementation、重新冻结与独立双审

禁止访问任何真实资源、执行真实retry或推进飞书UAT、部署与切换
