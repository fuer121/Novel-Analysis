---
checkpoint_id: CP-20260725-PHASE5-REAL-RETRY-EXECUTION-V2-GATE-SUBMITTED
task_id: PHASE5-REAL-RETRY-EXECUTION-V2
status: submitted
recorded_at: 2026-07-25T16:05:00+08:00
branch: codex/phase5-real-retry-execution-v2-gate
base_commit: e838fc2d5d76acdd09b9e748a1aa7f283c666e71
head_commit: e838fc2d5d76acdd09b9e748a1aa7f283c666e71
supersedes: none
---

# Phase 5 Real Retry Execution V2 Gate Submitted

## Scope

提交使用已接受identity v3 V2 frozen bytes执行唯一一次真实isolated rehearsal retry的Execution confirmation Gate

本提交不授权读取production snapshot、old key或Keychain，不连接Docker daemon，不创建真实演练数据库，也不执行migration、capacity、Dify、飞书、部署或切换

## Explicit Confirmation

只有用户明确回复接受`GATE-PHASE5-REAL-RETRY-EXECUTION-V2`才构成Execution confirmation

通用“继续”“推进”“授权”、历史自动授权或本Gate submission PR合并均不能替代该确认

Execution confirmation只授权本checkpoint定义的单次attempt，任一preflight hard stop、执行失败或cleanup blocked都会消耗授权，禁止自动retry

## Accepted Execution Identity

| Member | Required SHA-256 |
| --- | --- |
| `bootstrap.pl` | `d83d2d905c84f039e435f736cbbbfd0f2481e2c273f08aecf48176641d798e6b` |
| `catalog.json` | `06eeae2b6a6f08217a4b9c678aa0d8d65cc2acd19775cb545ac1e156a9767f9f` |
| `catalog.sha256` | `279f3dff7efabefe9b68cb625470bbe8803391f8303abb98b9f8fa26c460fe4d` |
| `entry.mjs` | `e7e1779266a26a963a36ff0173c9f7a2cf4740d68f4b81d38f365337b8ee42e9` |
| `execution.json` | `5c7be5a0c71dd3b9f3f685b920f33f9628c29adba38d2df11979cb8246143a69` |
| `identity-lib.mjs` | `b3576e208d3e0ad8a01d5b83fb446bddaf8aec9eaa4c12f97618392d6c5b648f` |
| `resource-lifecycle.mjs` | `abde0e72dba5f45ebb9e2e6e18c2068f5adda6919e28de9d8d3d2024ad0afa80` |
| `wrapper.sh` | `37be3589b784902d9430faf8a8ea05a632e5a5db5efcb38a7f4f95e946fe758f` |

Additional fixed anchors

- Repository execution anchor：`ee74fc4ca32f929735fcae9ecd4664cc73e97494`
- Stage artifact SHA-256：`acedef876bc35821ac0e708660d3ddc1d373d30eb97dc15fdc9846f863cc71d5`
- PostgreSQL image：`postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193`
- Candidate root必须为owner-owned `0700`，8个成员必须为owner-owned `0600`且无symlink
- Node、Perl、shell、Git与Docker client必须逐byte匹配accepted `execution.json`

任一identity、tool、catalog、detached digest、allowlist、mode、owner、symlink、repository HEAD或stage object mismatch必须在snapshot或key access前exit `70`

## Execution Inputs And Custody

Execution confirmation授权后仍必须在同一个不可拆分execution unit内fresh证明

| 输入或责任 | Required evidence |
| --- | --- |
| Snapshot validity | Canonical snapshot当前时间早于`2026-07-30T21:37:42+08:00`，fingerprint、integrity、owner、mode、type与sidecar allowlist全部通过 |
| Snapshot custody | 只读source、stage-owned private working copy、访问窗口、custodian与cleanup责任明确，项目文档和普通日志不记录真实路径 |
| Old key | Snapshot preflight通过后才允许ephemeral private delivery，载体`0600`或等价保护，使用后立即销毁 |
| Target keys | 每次attempt新生成canonical-base64 32-byte encryption key与HMAC key，彼此不同且不复用production或synthetic key |
| Migration database | Launcher-owned fresh isolated PostgreSQL container、network与anonymous volume，只绑定loopback dynamic port |
| Capacity database | 与migration完全独立的launcher-owned PostgreSQL container、network、anonymous volume、credentials与loopback dynamic port |
| Execution owner | 总控为唯一执行者与cleanup owner，不允许并发执行者或外部写入 |
| Evidence custody | Raw sinks与private BLOCKED evidence仅在execution custody window保留，sanitized evidence按Gate结果管理 |

不得把真实路径、credential、key、database URL、snapshot fingerprint、plaintext或其raw、base64、hex、URL、JSON escaping与SHA-256派生值写入Git、CI、普通终端或普通日志

## Authorized Single Execution Unit

Execution confirmation后只允许按以下顺序执行一次

1. 在独立clean worktree检出repository anchor并验证Git、stage object与全部accepted bytes
2. 验证candidate inventory、catalog、detached digest、tool identity、private sinks与六个预期resource name absence
3. 验证snapshot deadline、fingerprint、integrity、owner、mode、type、containment与sidecar allowlist
4. 创建stage-owned只读snapshot working copy
5. 受控读取old key并生成fresh target encryption与HMAC keys
6. 由launcher创建migration与capacity两套独立PostgreSQL container、network与container-owned anonymous storage
7. 执行initialize、migration、8项hard validations与accepted capacity suite
8. 执行完整sentinel、ordinary-output、manifest、sidecar、provenance、report与final readback扫描
9. 无论成功、失败或取消均先撤销访问并清理working copy、keys、process、private sinks、container、anonymous volume与network
10. Cleanup与fresh absence全部通过后才允许durable atomic PASS publication，否则只允许sanitized private BLOCKED evidence
11. 执行后由独立规格与质量reviewer核验result，再由总控创建result checkpoint

Preflight、database lifecycle、migration、capacity、evidence publication与failure cleanup是一个不可拆分的execution unit，禁止手工跳步或单独重跑某阶段

## Hard Validations And Thresholds

- Book count
- Chapter count
- Metadata
- Source integrity
- Content digest
- Target decrypt
- Target HMAC
- Scope exclusion
- Browse p95严格`<500ms`
- Submit p95严格`<1000ms`
- Status propagation p95严格`<2000ms`
- Interactive job ahead of queued background work为true
- Running step uninterrupted为true

任一validation、threshold、priority、identity、sentinel、publication、retention或cleanup失败均为BLOCKED，不得降级为warning

## Hard Stops

- Accepted bytes、tool identity、repository anchor、stage artifact、catalog、digest、inventory、mode、owner或symlink不匹配
- Snapshot已到deadline、fingerprint或integrity不匹配、custody不完整、出现未授权sidecar
- Old key在snapshot preflight前被访问，或key delivery、target key generation与销毁不能保持private
- Docker resource pre-absence失败、container identity或anonymous mount不完整、cleanup只能按name执行
- Migration与capacity resource不隔离，或发现正式database、Dify、飞书、部署或流量入口连接
- 普通终端、Git、CI、普通日志或retained evidence出现private path、credential、key、snapshot fingerprint、plaintext或派生敏感值
- Manifest、digest、status、fsync、rollback、cleanup、fresh absence或evidence retention失败
- 任一未解决Critical、Important、阻塞finding或证据冲突

Hard stop立即消耗本次attempt授权，进入统一cleanup并形成BLOCKED result，不得自动retry

## Retention And Cleanup

- Working snapshot、old key、target keys、database、container、anonymous volume、network、raw stdout/stderr、unsanitized report与private sinks在attempt结束、取消或hard stop时立即销毁
- Canonical snapshot继续遵守既有custodian与`2026-07-30T21:37:42+08:00`最晚deadline，本Gate不得延长
- Exact bundle custody window在result accepted、Gate拒绝、任务取消、attempt结束后7个自然日中的最早时间结束
- Cleanup必须以fresh process、file、local TCP、container ID与network ID absence证明完成
- 无法证明归属的orphan storage不得猜测删除，必须保留sanitized private BLOCKED claim并停止

## Prohibited Changes

- Migration、database Schema、capacity dataset、threshold、priority、Gate顺序或验收标准变化
- 新数据对象、新API、新认证、权限或credential语义
- Production mutation、entry rollback、Dify修改、Feishu UAT、deployment、traffic switch或cutover
- 修改accepted candidate、tool、stage artifact、repository anchor或PostgreSQL image
- 失败后自动retry、复用部分成功证据或手工补跑单独阶段

## Verification For This Submission

- Identity v3 V2 accepted checkpoint、DEC-0026与original real retry Gate contract已核验
- Accepted candidate final synthetic runner为`23/23 PASS`
- Independent spec与quality review均approved，无Critical或Important finding
- 当前governance main与origin/main同步且clean，SHA为`e838fc2d5d76acdd09b9e748a1aa7f283c666e71`
- 本提交未读取snapshot、old key、Keychain或真实credential
- 本提交未连接Docker daemon、database、network、Dify或飞书
- 本提交不包含真实路径、credential、snapshot fingerprint或敏感值

## Decisions Required

用户需明确回复：`接受 GATE-PHASE5-REAL-RETRY-EXECUTION-V2`

该确认授权唯一一次真实isolated rehearsal retry，并同意任一hard stop都会消耗attempt且不得自动retry

## Recommended Next Action

先完成本Gate submission PR的CI与用户审阅

用户明确接受Gate后，总控创建accepted Execution confirmation checkpoint，再按本Gate执行一次完整real retry execution unit

## Acceptance Request

请求用户接受或拒绝`GATE-PHASE5-REAL-RETRY-EXECUTION-V2`

接受前全部真实输入、Docker、database、network、Dify、飞书、UAT、deployment与cutover继续locked
