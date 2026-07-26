---
checkpoint_id: CP-20260726-PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-GATE-SUBMITTED
task_id: PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC
status: submitted
recorded_at: 2026-07-26T15:59:17+08:00
branch: codex/phase5-readonly-snapshot-diagnostic-gate
base_commit: 8969d56a586743bd659ebda916f09834dd77c2a2
head_commit: 8969d56a586743bd659ebda916f09834dd77c2a2
supersedes: none
---

# Phase 5 Read-Only Snapshot Diagnostic Gate Submitted

## Scope

提交使用accepted snapshot diagnostic candidate对既有受控真实config与snapshot执行一次只读诊断的named Gate

本提交只定义exact contract，不读取真实config、snapshot、old key或Keychain，不生成target keys，不连接Docker daemon、PostgreSQL、Dify或飞书，也不执行migration、capacity、UAT、部署、切换或retry

## Explicit Confirmation

只有本Gate submission PR合并后，用户明确回复`接受 GATE-PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC`才构成Execution confirmation

用户本轮允许准备并提交Gate，只授权创建、验证、推送和合并本exact contract，不替代contract落盘后的named acceptance

Execution confirmation只授权一次candidate preflight与一次candidate snapshot-preflight组成的不可拆分诊断attempt

任一preflight hard stop、snapshot-preflight PASS或FAIL、证据冲突、输出泄漏或cleanup blocked都会结束并消耗本次诊断授权，禁止自动retry、局部补跑或调用full execute

## Task Contract

- Task ID：`PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC`
- Core allowed modules：accepted repository-external candidate exact 8-member bundle、accepted private config与既有canonical snapshot的只读descriptor
- Mechanical adjacent scope：owner-only private stdout、stderr与diagnostic sinks，sanitized fixed-reason result checkpoint，直接对应的identity、ordinary-output与cleanup验证
- Base commit：`8969d56a586743bd659ebda916f09834dd77c2a2`
- Success criteria：exact candidate与anchors通过，ordinary stdout/stderr为零，只调用一次snapshot-preflight，得到一个完整且allowlisted的sanitized reason chain或PASS，未访问keys与runtime resources，private sinks清理并形成fresh absence evidence
- Prohibited changes：任何candidate、config、snapshot、repository、stage、tool或验收语义修改，真实snapshot写入或修复，key访问，Docker、database、migration、capacity、Dify、飞书、部署、切换、cutover或retry
- Required verification：identity与permission fresh check，candidate preflight，单次snapshot-preflight，调用次数证明，ordinary-output zero scan，diagnostic chain validation，key与runtime non-access audit，private sink cleanup与独立规格、质量审查
- Escalation conditions：任一identity mismatch、真实输入或资源范围扩大、非allowlisted或截断诊断、敏感输出、cleanup失败、Critical、Important或阻塞finding必须停止

## Accepted Diagnostic Identity

| Member | Required SHA-256 |
| --- | --- |
| `bootstrap.pl` | `dc42aa0760fa5ebe762514ce59ab7b36c5c173ae14500f187380d6e2124fe963` |
| `catalog.json` | `4963b9d6f7094cf952b8f86a7ccd84ca5c9f31c75a9a2b23fa544ee722bfe678` |
| `catalog.sha256` | `d564282b45db67c06343aa001df6028fa8cc652b725364c3fcd09d2adcfcdb82` |
| `entry.mjs` | `85c706328df054bf735a5c2df078d75716716bc44f4c618ca23fea35dc48d1de` |
| `execution.json` | `b5ecdfe748ffd4580a9dec0a34aeecd90b872036c182ac1710dd51c27ba7262b` |
| `identity-lib.mjs` | `b3576e208d3e0ad8a01d5b83fb446bddaf8aec9eaa4c12f97618392d6c5b648f` |
| `resource-lifecycle.mjs` | `abde0e72dba5f45ebb9e2e6e18c2068f5adda6919e28de9d8d3d2024ad0afa80` |
| `wrapper.sh` | `c119823a5f30dc7df93b6d2c02eaf7e9402b0b35153e81ff6d60759d42e7d96a` |

Review evidence manifest SHA-256必须匹配`f1fce155dca17de3397feac24a1262350240896179890d8207f77fabe9dab625`

Additional fixed anchors

- V3 config SHA-256：`86e13aba6dc14bbb50cabe12a6070d344a5fa42e0437afe8090b3b538900096f`
- Repository execution anchor：`ee74fc4ca32f929735fcae9ecd4664cc73e97494`
- Stage artifact SHA-256：`acedef876bc35821ac0e708660d3ddc1d373d30eb97dc15fdc9846f863cc71d5`
- Candidate root必须为owner-owned `0700`，8个members必须为owner-owned `0600`且无symlink
- Node、Perl、shell与Git必须逐byte匹配accepted `execution.json`

任一identity、tool、catalog、detached digest、allowlist、mode、owner、symlink、repository HEAD、stage object或config mismatch必须在snapshot access前exit `70`

## Required Inputs And Custody

Execution confirmation后仍必须在同一个不可拆分诊断unit内fresh证明

| 输入或责任 | Required evidence |
| --- | --- |
| Config custody | 既有accepted private config只读打开，owner、mode、type、containment与SHA-256匹配，不复制真实路径或内容到Git与ordinary output |
| Snapshot custody | 既有canonical snapshot由原custodian持有，只读打开，owner、mode、type、containment、latest deadline与complete sidecar absence满足accepted config |
| Snapshot validation | Candidate验证expected fingerprint与exact `PRAGMA integrity_check`，不得写入、修复、复制、解密或读取chapter plaintext |
| Execution owner | 总控为唯一执行者与cleanup owner，不允许并发执行者、外部写入或第二次调用 |
| Private sinks | stdout、stderr与diagnostic sink位于owner-only private目录，仅在本次diagnostic custody window保留 |
| Sanitized result | 只允许记录PASS或固定allowlisted stage/reason chain、exit status、ordinary-output零值、调用次数、key与runtime non-access以及cleanup结论 |

不得把真实路径、snapshot bytes、fingerprint、inode、credential、key、database URL、plaintext或其raw、base64、hex、URL、JSON escaping与SHA-256派生值写入Git、CI、ordinary terminal、ordinary logs或sanitized result

## Authorized Single Diagnostic Unit

Execution confirmation后只允许按以下顺序执行一次

1. 在owner-only private环境fresh验证accepted candidate inventory、permissions、catalog、detached digest、review manifest、tools、repository anchor与stage object
2. 验证private sinks为空且不存在本次任务创建的runtime、key、Docker、database、network或local TCP资源
3. 使用accepted candidate执行一次preflight，任一hard stop立即进入cleanup且不得打开snapshot
4. Preflight PASS后以同一candidate对accepted config与canonical snapshot执行一次`snapshot-preflight`
5. 只从private diagnostic sink提取完整allowlisted stage/reason chain或PASS状态，不读取动态异常文本，不进行第二次snapshot调用
6. 验证ordinary stdout/stderr为零、调用次数为一、未访问old key、Keychain、target key、Docker、database、Dify或飞书
7. 删除本次private stdout、stderr、diagnostic sinks与临时执行引用，保持canonical snapshot与config原custody和retention不变
8. Fresh absence与独立规格、质量审查通过后，由总控创建sanitized result checkpoint

Preflight、single snapshot-preflight、sanitized reason extraction、non-access audit与cleanup是一个不可拆分的diagnostic unit

本Gate不授权`full execute`、migration、capacity或任何后续阶段

## Hard Stops

- Accepted bytes、tool identity、repository anchor、stage artifact、catalog、digest、inventory、mode、owner、symlink或config不匹配
- Snapshot已到deadline、custody不完整、owner、mode、type、containment或sidecar条件不满足
- Candidate尝试写入、修复、复制或解密snapshot，读取chapter plaintext，访问key，或创建runtime、evidence、Docker、database、network或local TCP资源
- Ordinary stdout或stderr非零，private diagnostic包含未知reason、动态文本、非法链形、截断或success status不一致
- 真实路径、snapshot fingerprint、credential、key、plaintext或派生敏感值进入Git、CI、ordinary terminal、ordinary logs或sanitized result
- Snapshot-preflight被调用超过一次，失败后尝试局部补跑、直接检查snapshot或调用full execute
- Private sinks、process、temporary reference、访问撤销、fresh absence或evidence retention证明不完整
- 任一未解决Critical、Important、阻塞finding或证据冲突

Hard stop立即结束并消耗本次诊断授权，执行cleanup并形成sanitized `BLOCKED` result，不得自动retry

## Retention And Cleanup

- Canonical snapshot与accepted config继续遵守既有custodian和retention，不因本Gate延长、复制、删除或改变
- 本次private stdout、stderr、diagnostic sinks与临时执行引用在sanitized extraction和独立review所需最短窗口后立即销毁，最长不超过attempt结束后24小时
- Candidate exact bundle custody继续遵守accepted checkpoint，不复制到Git、CI或ordinary artifact
- Cleanup必须以fresh process、file、key、local TCP与本次task-owned runtime absence证明完成
- 无法证明归属的既有文件或资源不得猜测删除，只能形成sanitized private `BLOCKED` claim并停止

## Prohibited Changes

- 修改accepted candidate、config、snapshot、tool、stage artifact、repository anchor、diagnostic allowlist、Gate顺序或验收标准
- 新数据对象、新API、新认证、权限或credential语义
- 访问old key或Keychain，生成target encryption key或HMAC key，准备plaintext sentinel
- Snapshot写入、修复、复制、解密、chapter plaintext读取或retention延长
- Docker、PostgreSQL、migration、capacity、Dify、飞书、UAT、deployment、traffic switch或cutover
- 调用full execute、失败后自动retry、复用部分成功证据或手工补跑单独阶段
- 使用repository-external临时helper替代或包裹accepted candidate逻辑

## Verification For This Submission

- Snapshot diagnostic refinement accepted checkpoint记录`63/63 PASS`、`SPEC_APPROVED`与`QUALITY_APPROVED`
- Accepted candidate 8-member identity、review manifest与additional anchors已由accepted checkpoint冻结
- Governance main与origin/main同步且clean，提交前SHA为`8969d56a586743bd659ebda916f09834dd77c2a2`
- 本提交只新增Gate contract并更新项目源，没有修改candidate、config、snapshot、runtime或application code
- 本提交未读取真实config、snapshot、old key、Keychain、plaintext或credential
- 本提交未连接Docker daemon、database、network、Dify或飞书
- 本提交不包含真实路径、snapshot fingerprint、credential或sensitive data

## Decisions Required

本Gate submission PR合并后，用户需明确回复：`接受 GATE-PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC`

该确认只授权本checkpoint定义的一次只读diagnostic unit，并同意任一hard stop、PASS或FAIL都会消耗授权且不得自动retry

## Recommended Next Action

先完成本Gate submission PR的CI与合并

用户随后明确接受Gate后，总控创建accepted Execution confirmation checkpoint，再按本Gate执行一次只读snapshot diagnostic unit

## Acceptance Request

请求用户在本contract落盘并合并后接受或拒绝`GATE-PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC`

接受前真实config、snapshot诊断、keys、Docker、database、migration、capacity、Dify、飞书、UAT、deployment与cutover继续locked
