---
checkpoint_id: CP-20260724-PHASE5-REAL-RETRY-GATE-SUBMITTED
task_id: PHASE5-REAL-RETRY-GATE
status: submitted
recorded_at: 2026-07-24T18:04:31+08:00
branch: codex/phase5-real-retry-gate-submitted
base_commit: b8e4aa6e0431dd937a894de54164a9de7128811b
head_commit: b8e4aa6e0431dd937a894de54164a9de7128811b
supersedes: none
---

# Phase 5 Real Retry Gate Submitted

## Scope

提交一次真实isolated rehearsal retry的范围、安全边界、exact execution identity、输入custody、hard validations、capacity thresholds、失败停止、retention与cleanup条件

本提交不授权读取production snapshot、old production key或Keychain，不创建真实演练数据库，不执行migration rehearsal，不访问Dify或飞书，不推进UAT、deployment、traffic switch或cutover

## Gate Model

本Gate要求两次明确用户确认，任何线程中的通用“继续”“推进”或历史自动授权均不能替代

1. Contract confirmation：接受本Gate的范围与安全条件，只授权在无真实输入条件下准备、测试、冻结并独立审查real retry execution identity
2. Execution confirmation：在exact SHA、snapshot有效窗口、key custody、target isolation、cleanup owner与pre-run hard stops全部形成可核验证据后，用户明确授权唯一一次真实retry

Contract confirmation不授权访问snapshot、old key或执行真实rehearsal

## Preconditions Before Identity Preparation

- [Phase 5 synthetic E2E calibration V5 accepted](CP-20260724-PHASE5-SYNTHETIC-E2E-CALIBRATION-V5-ACCEPTED.md)保持accepted且无correction
- Real execution unit复用V5已经验证的containment、private stdio、runtime sentinel、manifest digest、finally cleanup与fail-closed原则
- 不复制V5 synthetic fixture生成行为到真实retry，不把synthetic bytes误标为real execution identity
- 不修改migration语义、database Schema、8项hard validations、capacity thresholds、Gate顺序或验收标准

## Required Real Execution Identity

在任何真实输入访问前必须完成新的repository-external exact bundle，并同时满足

- Launcher、wrapper与必要helper具有明确SHA-256、catalog与detached digest
- Exact bundle只包含allowlist文件，目录`0700`、文件`0600`、无symlink
- Git trust anchor绑定approved implementation commit，mismatch在snapshot或key访问前hard stop
- Snapshot path、old-key path、target paths与ordinary output sinks均执行containment、type、mode与symlink检查
- Outer与child stdout/stderr只写入private `0600` sinks，普通终端不输出路径、credential、fingerprint或敏感值
- Snapshot fingerprint、database URL、old key、target keys、plaintext与private paths进入value-aware scan
- 原始manifest bytes与digest sidecar在发布后独立复算并记录provenance
- Spawn、timeout、missing status、malformed status与任意阶段失败均进入统一cleanup
- Exact bytes完成focused tests、独立spec review与quality review，所有Critical、Important与阻塞性finding关闭

Identity准备与审查不得读取production snapshot、old key或Keychain，不得启动真实PostgreSQL或执行migration

## Inputs And Custody Before Execution Confirmation

| 输入或责任 | Execution confirmation前必须提供的证据 |
| --- | --- |
| Snapshot validity | Fresh确认canonical snapshot未超过既有`2026-07-30T21:37:42+08:00`最晚deadline，fingerprint与integrity检查方法已固定 |
| Snapshot access | Owner、Approver、custodian、只读copy窗口、private location类别与cleanup责任明确，不在项目文档记录真实路径 |
| Old key | Custodian、ephemeral delivery窗口、private `0600`载体或等价机制、禁止普通日志与使用后销毁责任明确 |
| Target keys | 每次执行新生成，encryption key与HMAC key均为canonical-base64 32-byte且彼此不同，不复用synthetic或production key |
| Target database | Fresh isolated PostgreSQL，仅包含accepted seed state，不连接正式数据库，不允许外部写入 |
| Capacity database | 与migration target隔离，使用accepted local-idle benchmark contract，不共享正式服务资源 |
| Execution owner | 唯一执行者、观察者、取消责任与cleanup owner明确 |
| Evidence custody | Private sinks、manifest、catalog、reports与sanitized result的custodian、访问撤销与retention deadline明确 |

任何一项缺失均保持Gate submitted，不得用历史线程信息补全

## Authorized Sequence After Execution Confirmation

1. Fresh核验exact execution identity、Git anchor、target profile、资源absence与private sinks
2. 核验snapshot retention、fingerprint与integrity，失败时在old-key access前停止
3. 建立只读snapshot working copy并记录不含真实路径的custody evidence
4. 受控交付old key并生成fresh target encryption与HMAC keys
5. 创建fresh isolated migration PostgreSQL与独立capacity database
6. 执行现有migration CLI与8项hard validations
7. 执行accepted capacity suite与priority checks
8. 原子发布sanitized manifest、digest、catalog与result evidence
9. 无论成功或失败均撤销访问并清理working snapshot、keys、databases、containers、volumes、networks、raw outputs与private sinks
10. 完成独立spec与quality review后提交result checkpoint

不得拆分为先读取真实输入再补identity或evidence的多个retry

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

任一validation、threshold、priority、atomic publication、leakage scan或cleanup失败均为BLOCKED，不得降级为warning

## Hard Stops

- Exact byte、catalog、detached digest、Git anchor或allowlist不匹配
- Snapshot retention到期、fingerprint不匹配、integrity失败、出现未授权sidecar或custody不完整
- Old key在snapshot preflight通过前被访问，或key delivery无法保持private与ephemeral
- Target database不是fresh isolated状态，或发现正式数据库、Dify、飞书、部署与流量入口连接
- Ordinary terminal、Git、CI、普通日志或retained evidence出现private path、credential、key、snapshot fingerprint或敏感数据
- Manifest/digest原子发布、status完整性、resource cleanup或evidence retention失败
- 任意未解决Critical、Important、阻塞性finding或证据冲突

Hard stop立即消耗本次执行授权，完成cleanup并形成blocked checkpoint，不得自动重跑

## Retention And Cleanup

- Identity drafting artifacts在exact bundle接受后立即清理，只保留执行所需exact bundle、catalog与最小identity record
- Exact bundle custody window持续至本次retry结果accepted、Gate拒绝、任务取消或retry结束后7个自然日中的最早时间
- Working snapshot、old key、target keys、真实database、raw stdout/stderr与unsanitized reports在retry结束或取消时立即销毁
- Canonical snapshot继续遵守既有custodian与最晚deadline，不因本Gate延长
- Cleanup必须以fresh absence检查证明container、volume、network、database、working files、keys、sinks与process均无残留

## Prohibited Changes

- Migration或database Schema语义变化
- 新数据对象、新API能力、新认证或权限语义
- Capacity dataset、threshold或priority contract变化
- Production mutation、entry rollback、Dify修改、Feishu UAT、deployment、traffic switch或cutover
- 在Execution confirmation前访问任何真实snapshot、old key或Keychain
- 失败后自动retry或用部分成功证据推进later Gate

## Verification For This Submission

- 项目唯一信源与V5 accepted calibration checkpoint已核验
- 当前main与origin/main同步且clean，SHA为`b8e4aa6e0431dd937a894de54164a9de7128811b`
- 本提交未读取、复制、fingerprint或解密production snapshot
- 本提交未请求或使用old production key、Keychain、真实database或正式环境
- 本提交不包含真实路径、credential、fingerprint或敏感值

## Decisions Required

请用户确认是否接受本Gate contract，并仅授权下一步在无真实输入条件下准备、冻结和审查real retry exact execution identity

接受本提交不等于授权真实retry，exact identity完成后仍必须再次获得Execution confirmation

## Recommended Next Action

用户明确接受Gate contract后，总控只推进real retry execution identity准备与focused验证，完成双审后提交Execution confirmation checkpoint

## Acceptance Request

请求用户接受或拒绝本Gate contract

在明确接受前，production snapshot、old production key、Keychain、真实演练数据库与real retry继续locked
