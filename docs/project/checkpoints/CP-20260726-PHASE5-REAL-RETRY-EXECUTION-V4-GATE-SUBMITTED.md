---
checkpoint_id: CP-20260726-PHASE5-REAL-RETRY-EXECUTION-V4-GATE-SUBMITTED
task_id: PHASE5-REAL-RETRY-EXECUTION-V4
status: submitted
recorded_at: 2026-07-26T11:30:00+08:00
branch: codex/phase5-real-retry-execution-v4-gate
base_commit: e43aa7669196b19d3609f5c068efcc21570e3b30
head_commit: e43aa7669196b19d3609f5c068efcc21570e3b30
supersedes: none
---

# Phase 5 Real Retry Execution V4 Gate Submitted

## Scope

提交使用accepted preflight diagnostic candidate执行唯一一次真实isolated rehearsal retry的Execution confirmation Gate

本提交只定义exact contract，不读取真实config、production snapshot bytes、old key或Keychain，不生成target keys，不连接Docker daemon，不创建真实演练数据库，也不执行migration、capacity、Dify、飞书、部署或切换

## Explicit Confirmation

只有本Gate submission PR合并后，用户明确回复`接受 GATE-PHASE5-REAL-RETRY-EXECUTION-V4`才构成Execution confirmation

用户本轮允许提交Gate，仅授权创建、审阅和合并本exact contract，不替代contract落盘后的named acceptance

Execution confirmation只授权本checkpoint定义的单次不可拆分attempt，任一preflight hard stop、执行失败或cleanup blocked都会消耗授权，禁止自动retry或局部补跑

## Accepted Execution Identity

| Member | Required SHA-256 |
| --- | --- |
| `bootstrap.pl` | `9feb447c776512620401805f14496cbb453cb860c8ff246d86c6d878ed02a470` |
| `catalog.json` | `dfa0249b388696d025610e7df9240d65242588ad2b6f99fc41966bcbd087a844` |
| `catalog.sha256` | `ad1ada779de079df66ead1eb743425261ab8f4baa8dc3ec2f0471d711ca4fea3` |
| `entry.mjs` | `466de20fec41ea9bbdf8199f41ffe5e3af009a8e5bd92d48d1394c09ce7b1227` |
| `execution.json` | `b5ecdfe748ffd4580a9dec0a34aeecd90b872036c182ac1710dd51c27ba7262b` |
| `identity-lib.mjs` | `b3576e208d3e0ad8a01d5b83fb446bddaf8aec9eaa4c12f97618392d6c5b648f` |
| `resource-lifecycle.mjs` | `abde0e72dba5f45ebb9e2e6e18c2068f5adda6919e28de9d8d3d2024ad0afa80` |
| `wrapper.sh` | `a8485464848710a39a36ca93ace065e067ef5380c8a08f285b2761e16fb11854` |

Review evidence manifest SHA-256必须匹配`0e04e2f63d4b1d092d77e14b6c3656748e045ad45e83169eac436868b20b4706`

Additional fixed anchors

- V3 config SHA-256：`86e13aba6dc14bbb50cabe12a6070d344a5fa42e0437afe8090b3b538900096f`
- Repository execution anchor：`ee74fc4ca32f929735fcae9ecd4664cc73e97494`
- Stage artifact SHA-256：`acedef876bc35821ac0e708660d3ddc1d373d30eb97dc15fdc9846f863cc71d5`
- PostgreSQL image：`postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193`
- Snapshot latest deadline：`2026-07-30T21:37:42+08:00`
- Candidate root必须为owner-owned `0700`，8个成员必须为owner-owned `0600`且无symlink
- Node、Perl、shell、Git与Docker client必须逐byte匹配accepted `execution.json`

任一identity、tool、catalog、detached digest、allowlist、mode、owner、symlink、repository HEAD或stage object mismatch必须在snapshot或key access前exit `70`

## Execution Inputs And Custody

Execution confirmation后仍必须在同一个不可拆分execution unit内fresh证明

| 输入或责任 | Required evidence |
| --- | --- |
| Snapshot validity | 当前时间早于`2026-07-30T21:37:42+08:00`，fingerprint、exact `PRAGMA integrity_check`、owner、mode、type、containment与complete sidecar absence全部通过 |
| Snapshot custody | 只读canonical source、访问窗口、custodian与cleanup责任明确，Git、CI与ordinary output不记录真实路径 |
| Old key | Candidate snapshot-preflight通过后才允许ephemeral private delivery，载体owner-owned `0600`且使用后立即销毁 |
| Target keys | Snapshot-preflight通过后每次attempt新生成canonical-base64 32-byte encryption key与HMAC key，彼此不同且不复用production或synthetic key |
| Plaintext sentinel | Snapshot-preflight通过后才允许private delivery，载体owner-owned `0600`且使用后立即销毁 |
| Migration database | Launcher-owned fresh isolated PostgreSQL container、network与container-owned anonymous storage，只绑定loopback dynamic port |
| Capacity database | 与migration完全独立的launcher-owned PostgreSQL container、network、anonymous storage、credentials与loopback dynamic port |
| Execution owner | 总控为唯一执行者与cleanup owner，不允许并发执行者或外部写入 |
| Evidence custody | Raw sinks与private BLOCKED evidence仅在execution custody window保留，sanitized evidence按Gate结果管理 |

不得把真实路径、credential、key、database URL、snapshot fingerprint、plaintext或其raw、base64、hex、URL、JSON escaping与SHA-256派生值写入Git、CI、ordinary terminal或ordinary logs

## Authorized Single Execution Unit

Execution confirmation后只允许按以下顺序执行一次

1. 在独立clean worktree检出repository anchor并由accepted candidate验证exact bundle、tools、Git与large stage bytes
2. 验证private sinks与全部预期resource name absence，不增加repository-external临时helper或重复实现candidate checker
3. 以同一candidate执行snapshot-preflight，验证config、repository、stage、snapshot deadline、fingerprint、complete sidecar absence、exact SQLite integrity与custody
4. Snapshot-preflight PASS后才允许受控读取old key、生成fresh target encryption与HMAC keys并准备plaintext sentinel
5. 以同一candidate调用一次full execute，再次验证identity、tools、repository、stage、config与snapshot后才消费keys
6. Launcher创建migration与capacity两套独立PostgreSQL container、network与container-owned anonymous storage
7. 执行initialize、migration、8项hard validations与accepted capacity suite
8. 执行完整sentinel、ordinary-output、manifest、sidecar、provenance、report与final readback扫描
9. 无论成功、失败或取消均先撤销访问并清理keys、process、private sinks、container、anonymous storage与network
10. Cleanup与fresh absence全部通过后才允许durable atomic PASS publication，否则只允许sanitized private BLOCKED evidence
11. 执行后由独立规格与质量reviewer核验result，再由总控创建result checkpoint

Preflight、snapshot preflight、key preparation、database lifecycle、migration、capacity、evidence publication与failure cleanup是一个不可拆分的execution unit，禁止手工跳步或单独重跑某阶段

## Hard Validations And Thresholds

- Book count、chapter count、metadata、source integrity、content digest、target decrypt、target HMAC、scope exclusion全部通过
- Browse p95严格`<500ms`
- Submit p95严格`<1000ms`
- Status propagation p95严格`<2000ms`
- Interactive job ahead of queued background work为true
- Running step uninterrupted为true

任一validation、threshold、priority、identity、sentinel、publication、retention或cleanup失败均为BLOCKED，不得降级为warning

## Hard Stops

- Accepted bytes、tool identity、repository anchor、stage artifact、catalog、digest、inventory、mode、owner、symlink或config不匹配
- Snapshot已到deadline、fingerprint或integrity不匹配、custody不完整或出现任何basename sidecar
- Old key、target key generation或plaintext sentinel delivery发生在snapshot-preflight PASS前
- Docker resource pre-absence失败、resource identity或cleanup证明不完整
- Migration与capacity resource不隔离，或发现正式database、Dify、飞书、部署或流量入口连接
- Ordinary terminal、Git、CI、ordinary logs或retained evidence出现private path、credential、key、snapshot fingerprint、plaintext或派生敏感值
- Manifest、digest、status、fsync、rollback、cleanup、fresh absence或evidence retention失败
- 任一未解决Critical、Important、阻塞finding或证据冲突

Hard stop立即消耗本次attempt授权，进入统一cleanup并形成BLOCKED result，不得自动retry

## Retention And Cleanup

- Old key、target keys、plaintext sentinel、database、container、anonymous storage、network、raw stdout/stderr、unsanitized report与private sinks在attempt结束、取消或hard stop时立即销毁
- Canonical snapshot继续遵守既有custodian与latest deadline，本Gate不得延长
- Exact bundle custody window在result accepted、Gate拒绝、任务取消、attempt结束后7个自然日中的最早时间结束
- Cleanup必须以fresh process、file、local TCP、container ID与network ID absence证明完成
- 无法证明归属的orphan storage不得猜测删除，必须保留sanitized private BLOCKED claim并停止

## Prohibited Changes

- Migration、database Schema、capacity dataset、threshold、priority、Gate顺序或验收标准变化
- 新数据对象、新API、新认证、权限或credential语义
- Production mutation、entry rollback、Dify修改、Feishu UAT、deployment、traffic switch或cutover
- 修改accepted candidate、tool、stage artifact、repository anchor或PostgreSQL image
- 使用未经完整验证的repository-external临时helper
- 失败后自动retry、复用部分成功证据或手工补跑单独阶段

## Verification For This Submission

- Preflight diagnostic correction accepted checkpoint记录`57/57 PASS`与独立`SPEC_APPROVED`、`QUALITY_APPROVED`
- Accepted candidate 8-member identity、catalog、detached digest、permissions、诊断allowlist与旧candidate不变性已fresh验证
- Governance main与origin/main同步且clean，提交前SHA为`e43aa7669196b19d3609f5c068efcc21570e3b30`
- 本提交未读取config、snapshot、old key、Keychain、plaintext或真实credential
- 本提交未连接Docker daemon、database、network、Dify或飞书
- 本提交不包含真实路径、credential、snapshot fingerprint或sensitive data

## Decisions Required

本Gate submission PR合并后，用户需明确回复：`接受 GATE-PHASE5-REAL-RETRY-EXECUTION-V4`

该确认授权唯一一次真实isolated rehearsal retry，并同意任一hard stop都会消耗attempt且不得自动retry

## Recommended Next Action

先完成本Gate submission PR的CI与合并

用户随后明确接受Gate后，总控创建accepted Execution confirmation checkpoint，再按本Gate执行一次完整real retry execution unit

## Acceptance Request

请求用户在本contract落盘并合并后接受或拒绝`GATE-PHASE5-REAL-RETRY-EXECUTION-V4`

接受前全部真实输入、Docker、database、network、Dify、飞书、UAT、deployment与cutover继续locked
