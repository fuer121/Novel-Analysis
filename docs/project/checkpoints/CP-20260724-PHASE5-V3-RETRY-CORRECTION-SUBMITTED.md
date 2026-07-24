---
checkpoint_id: CP-20260724-PHASE5-V3-RETRY-CORRECTION-SUBMITTED
task_id: PHASE5-TARGET-SERVER-ISOLATED-REHEARSAL
status: submitted
recorded_at: 2026-07-24T11:36:52+08:00
branch: codex/phase5-v3-correction-submitted
base_commit: 62140af90cd533a0e92feb780a73168e94324136
head_commit: 62140af90cd533a0e92feb780a73168e94324136
supersedes: none
---

# Phase 5 V3 Retry Correction Quality Fix Submitted

## Scope

提交v3 private identity evidence的最小质量修正，请求独立核验content-addressed launch handoff、identity allowlist与custody lifecycle

本checkpoint不授权实际retry，不访问production snapshot、old production key、real Dify、Feishu、UAT、deployment、traffic或cutover

## Atomic Launch Handoff

- Launcher以`O_NOFOLLOW`打开wrapper与target，对已打开文件读取的bytes计算SHA-256并与caller提供的trusted digest比较
- 任一digest格式错误或mismatch均在创建process sinks、启动child或使用snapshot/key runtime input前以exit `70` hard-stop
- 验证通过的exact wrapper bytes通过stdin交给Bash，exact target bytes通过受控base64 handoff交给wrapper，不再从已匹配路径重新读取或执行
- Wrapper再次验证target bytes digest，只允许`bash`或`node`两种runtime
- Helper改为参数化ES module，只从runtime参数取得repository root、synthetic database URL与private result sink，不保留具体路径或环境值
- 不修改repository migration、schema、migration CLI、target data或业务语义

## Retained Identity Allowlist

Retained bundle只允许以下五个`0600`文件，任何额外文件均使identity无效

- `verified-launch.mjs`
- `protocol-wrapper.sh`
- `init-migration.mjs`
- `identity.json`
- `identity.sha256`

`identity.json`采用exact field allowlist

| Object | Allowed fields |
| --- | --- |
| Top level | `schemaVersion`、`status`、`files`、`launch`、`synthetic`、`custody` |
| Each `files` entry | `name`、`sha256` |
| `launch` | `handoff`、`digestAlgorithm`、`mismatchExitCode`、`runtimeAllowlist` |
| `synthetic` | external-directory/no-package/no-node-modules flags、PostgreSQL major、helper exit/schema/admin/domain-empty claims、wrapper byte counts、deterministic failure exit、private capture与所有prohibited-access false flags |
| `custody` | custodian role、publication/retention timestamps、raw destruction requirement、replacement order、destroy-before-snapshot-or-key flag |

Bundle内容只包含parameterized scripts、script hashes、version/status、scalar synthetic claims与custody metadata，不包含private或absolute path、host/asset identity、concrete `NODE_PATH`或其他环境值、credential、key、snapshot fingerprint、raw output或database content

`identity.sha256`使用`shasum -a 256 -c identity.sha256`可直接验证的`digest  identity.json`格式

## Candidate Git Trust Anchor

本submitted correction记录的candidate `identity.json` SHA-256为`db4265cb9932da4b4189afeb54343eb82001609dae5b2118c9f81d6e69bc72ec`

未来accepted correction必须逐字复述同一64hex digest，任何不同、缺失或缩写均不得解锁retry

Authorized pre-run必须按以下信任顺序执行

1. 只从accepted Git checkpoint读取manifest anchor，不从private bundle自证信任
2. 以`O_NOFOLLOW`打开`identity.json`并对opened bytes计算SHA-256，必须与accepted Git anchor完全一致
3. 只从已anchored manifest导出launcher、wrapper与helper script digests
4. 使用这些anchored script digests执行verified-byte handoff

Git anchor、opened manifest或任一script digest发生mismatch时，必须在创建process sinks、child launch或使用snapshot/key runtime inputs前以exit `70` hard-stop

Bundle内`identity.sha256`只用于传输一致性检查，不是独立trust root；`identity.json`、detached hash与scripts即使被协同重写，也不能绕过accepted Git anchor

## Synthetic Verification

Final synthetic run位于repository外、无`package.json`、无local `node_modules`的private directory，并使用一次性PostgreSQL 17 container与synthetic database

| Check | Result |
| --- | --- |
| External helper process exit | `0` |
| Digest mismatch exit / child sinks | `70 / NOT CREATED` |
| Schema version | `007_advanced_analysis` |
| Active admins | `1` |
| Domain tables empty | `PASS` |
| Wrapper success stdout/stderr | `0 / 0 bytes` |
| Deterministic wrapper failure exit | `23` |
| Private failure captured only in private sink | `PASS` |
| Isolated container cleanup | `PASS` |
| Bundle file/field allowlist | `PASS` |
| Detached manifest hash | `PASS` |
| Sensitive sentinel scan | `PASS` |
| Production snapshot access | `NOT RUN` |
| Production key access | `NOT RUN` |

本次质量修正中的两次helper packaging diagnostic均在migration execution前停止，对应raw bundle与container立即销毁且absence verified，不得用于本checkpoint接受

## Evidence Lifecycle Correction

Synthetic raw evidence与pre-run identity artifact完全分离

- Replacement identity先完成file/field allowlist、script hash、detached hash、permissions、sentinel与synthetic result验证，再发布为final retained bundle
- Final raw logs、container outputs、launch results、failure output与working scripts在final identity发布并复验后立即销毁
- 旧invalid identity bundle只在replacement验证与发布完成后销毁
- Fresh absence verification确认failed/final raw directories、旧bundle、candidate目录与copies均不存在，只保留一个final identity bundle
- Controller Agent为唯一custodian
- Protocol acceptance本身不触发identity bundle到期
- Identity bundle在authorized pre-run verified launch完成、correction拒绝或取消、或publication后七天中的最早时间到期
- Pre-run match完成后必须在production snapshot copy与old-key access前立即销毁identity bundle及全部copies并验证不存在
- Identity文件任一byte变化时本授权失效，必须重新synthetic verification与确认

## Requested Retry Boundary

本checkpoint保持`submitted`，不自行接受correction或解锁actual retry

若后续获得明确接受，retry仍必须使用全新private run directory、全新ephemeral target keys、全新isolated migration与capacity databases，并保持原accepted Gate的commands、8项hard validation、capacity thresholds、hard stops、cleanup、retention与still-locked范围不变

## Decision Required

请先对本次quality fix执行独立spec与quality review，再决定接受、拒绝或要求补充证据

接受不解锁`GATE-PHASE5-FEISHU-UAT`、real Dify、Feishu、deployment、traffic或cutover
