---
checkpoint_id: CP-20260725-PHASE5-SNAPSHOT-PREFLIGHT-CORRECTION-STARTED
task_id: PHASE5-SNAPSHOT-PREFLIGHT-CORRECTION
status: accepted
recorded_at: 2026-07-25T20:40:35+08:00
branch: codex/phase5-snapshot-preflight-correction-started
base_commit: f061d20c2b852a68af44d6b26195faaf5493b14e
head_commit: f061d20c2b852a68af44d6b26195faaf5493b14e
supersedes: CP-20260725-PHASE5-REAL-RETRY-EXECUTION-V3-PREPARATION-BLOCKED
---

# Phase 5 Snapshot Preflight Correction Started

## Scope

实施[DEC-0028 Snapshot Preflight Mode](../decisions/DEC-0028-phase5-snapshot-preflight-mode.md)，在新candidate副本中增加不接触keys与runtime resources的独立snapshot preflight，并保持full execute二次完整复验

## Task Contract

- Task ID：`PHASE5-SNAPSHOT-PREFLIGHT-CORRECTION`
- Core allowed modules：repository外新candidate副本中的`bootstrap.pl`、`wrapper.sh`与`entry.mjs`
- Mechanical adjacent scope：直接synthetic tests、fixtures、既有identity helper wiring、execution metadata、catalog、digest与sanitized review evidence
- Base commit：`f061d20c2b852a68af44d6b26195faaf5493b14e`
- Success criteria：无key文件时snapshot preflight通过；任一preflight失败不访问key且不创建runtime或真实资源；ordinary output为零；full execute二次复验；complete synthetic、leakage、cleanup、scope audit与独立双审全部通过；最终bytes与SHA重新冻结
- Prohibited changes：repository product code、migration语义、database schema、capacity threshold、Gate顺序、验收标准、accepted candidate原目录、production snapshot bytes、old key、Keychain、target key generation、Docker、PostgreSQL、Dify、飞书、UAT、deployment、traffic switch、cutover与真实retry
- Required verification：RED/GREEN focused tests、missing-key success、config/SHA/repository/stage/snapshot failure matrix、zero key access、zero runtime/evidence/resource creation、bootstrap zero output、full execute revalidation、exact identity、full synthetic suite、leakage scan、cleanup absence、scope audit、independent spec review与quality review
- Escalation conditions：新增外部依赖、新数据或安全语义、放宽任何Gate、修改frozen config bytes、无法保持single candidate trust boundary、发现Critical、Important或阻塞性finding、证据冲突或需要任何真实资源

## Authorization

用户明确选择Option A并授权synthetic snapshot-preflight correction

真实资源与任何retry继续locked，新的real retry必须等待本任务accepted后另行提交named Gate并获得明确确认

## Evidence

- Execution V3 preparation blocked checkpoint证明full execute前置key文件要求破坏完整执行单元ordering
- 用户明确选择Option A
- Correction开始时main为`f061d20c2b852a68af44d6b26195faaf5493b14e`且clean

## Accepted Result

解锁`PHASE5-SNAPSHOT-PREFLIGHT-CORRECTION`的repository-external synthetic implementation、重新冻结与独立双审

禁止访问任何真实资源、修改既有frozen config bytes或执行真实retry
