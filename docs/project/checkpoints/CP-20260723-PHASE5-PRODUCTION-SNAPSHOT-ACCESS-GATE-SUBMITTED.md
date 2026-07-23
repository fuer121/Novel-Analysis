---
checkpoint_id: CP-20260723-PHASE5-PRODUCTION-SNAPSHOT-ACCESS-GATE-SUBMITTED
task_id: GATE-PHASE5-PRODUCTION-SNAPSHOT-ACCESS
status: submitted
recorded_at: 2026-07-23T21:15:26+08:00
branch: codex/phase5-snapshot-access-gate
base_commit: cc6366a4fe87d6b17b59baa8ad5dd763863bf1e6
head_commit: cc6366a4fe87d6b17b59baa8ad5dd763863bf1e6
supersedes: none
---

# Phase 5 Production Snapshot Access Gate Submitted

## Requested Authorization

请求接受`GATE-PHASE5-PRODUCTION-SNAPSHOT-ACCESS`，只解锁以下受控操作

- 由指定Owner在批准的访问窗口内，通过SQLite online backup primitive取得一份consistent point-in-time production SQLite snapshot
- 禁止直接复制正在运行的`.sqlite`、`.sqlite-wal`或`.sqlite-shm`文件，snapshot acquisition不得写入或修复production SQLite
- 将snapshot以指定Owner、非symbolic link、`0600`权限存放到批准的isolated location
- 只读执行standalone、sidecar absence、`PRAGMA integrity_check`、SHA-256 fingerprint与文件权限验证
- 记录不含真实路径和凭证的source provenance、访问起止时间、Owner、Approver、acquisition method、private evidence location与retention deadline

本Gate不授权请求、复制、读取或使用old production key，不授权运行migration CLI或target-server isolated rehearsal

## Required Inputs Before Access

| 输入 | 必须满足 |
| --- | --- |
| Owner | 明确本次snapshot acquisition与integrity verification执行负责人 |
| Approver | 明确production snapshot acquisition与controlled custody审批人 |
| Access window | 明确开始与结束时间，窗口外禁止继续访问 |
| Snapshot source | 明确production SQLite owner与SQLite online backup primitive，禁止raw file copy |
| Isolated storage | 明确不被应用服务、同步盘、非批准备份代理或无关用户读取的存放位置与custodian |
| Snapshot controls | 指定Owner、非symbolic link、`0600`，且父目录不得允许无关用户遍历 |
| Old-key custodian | 只记录后续Gate的旧密钥保管人，本Gate不得交付或使用旧密钥 |
| Retention | 最长保留至acquisition后7个自然日，或rehearsal完成、Gate拒绝、任务取消中的最早时间 |
| Cleanup | 窗口结束立即撤销执行者访问，retention到期由custodian验证销毁snapshot及其所有工作副本并留证 |

任何必填输入只能在用户接受本Gate后收集，不得将真实路径、密钥、快照指纹或访问凭证提交到Git

## Hard Stops

出现以下任一情况必须立即停止，不得通过修复正式快照、放宽校验或继续部分迁移绕过

- 缺少Owner、Approver、访问窗口或old-key custodian
- 无法使用SQLite online backup primitive，需要raw copy live database或需要暂停、写入、修复production SQLite
- snapshot无法standalone只读打开、存在sidecar、`PRAGMA integrity_check`不是`ok`，或验证期间fingerprint变化
- snapshot来源、指定Owner、非symbolic link、`0600`、父目录隔离或访问审计无法证明
- 需要请求、复制、读取或使用old production key
- 需要读取chapter plaintext、运行migration CLI、连接PostgreSQL或开始target-server rehearsal
- 真实路径、snapshot、fingerprint或任何凭证需要进入Git、普通日志或非批准artifact
- 无法在访问窗口结束时撤销执行者访问，或无法给出不超过7个自然日的retention deadline
- 需要修改acquisition semantics、数据范围、安全策略、Gate顺序或验收标准

## Explicitly Still Prohibited

本Gate即使接受也不授权

- 修改production SQLite、旧应用数据或旧密钥
- 请求或使用old production key，解密章节或读取chapter plaintext
- 运行migration CLI、创建或连接rehearsal PostgreSQL、执行hard validation或capacity test
- 将snapshot或任何后续rehearsal artifact直接晋升为正式环境
- 访问real Dify或修改Dify workflow、Prompt、Schema
- 修改Feishu callback、邀请代表用户或执行UAT
- 部署正式服务、停止旧服务、创建正式新库、切换域名或流量
- 正式cutover、旧入口关闭、90天备份销毁或任何不可逆操作

## Verification And Evidence

snapshot acquisition完成后必须形成下一Gate所需的private evidence

- acquisition使用SQLite online backup primitive且没有修改production SQLite
- snapshot standalone只读打开、无sidecar且`PRAGMA integrity_check`返回`ok`
- snapshot fingerprint在首次验证与访问窗口结束时一致
- snapshot为指定Owner、非symbolic link、`0600`且父目录隔离
- source provenance、acquisition method、访问审计、private evidence location与retention deadline均有记录
- 窗口结束时执行者访问已撤销，custodian成为retention期间唯一授权持有人
- snapshot、真实路径与fingerprint不进入Git、普通日志或非批准artifact

任一验证失败时只能提交blocked checkpoint，不得请求target-server isolated rehearsal Gate

## Current Evidence

- [Phase 5 tools Gate accepted](CP-20260723-PHASE5-TOOLS-GATE-ACCEPTED.md)
- [Phase 5 snapshot access checklist](../../operations/phase5-snapshot-access.md)
- [Phase 5 Gate dossier](../../operations/phase5-gate-dossier.md)
- [Phase 5 migration and cutover design](../../superpowers/specs/2026-07-23-phase-5-migration-cutover-design.md)
- 当前提交未读取、复制、解密或fingerprint production snapshot，未请求或使用old production key

## Decision Required

请用户明确接受或拒绝`GATE-PHASE5-PRODUCTION-SNAPSHOT-ACCESS`

## Recommended Next Action

用户接受后，总控先收集Required Inputs并再次核对hard stops，再执行受控snapshot acquisition与private evidence verification

snapshot access结果通过后，必须另行提交`GATE-PHASE5-TARGET-SERVER-ISOLATED-REHEARSAL`并等待用户明确接受，之后才可请求old production key或执行迁移与性能演练

用户接受前保持所有production data、old key与external operation locked
