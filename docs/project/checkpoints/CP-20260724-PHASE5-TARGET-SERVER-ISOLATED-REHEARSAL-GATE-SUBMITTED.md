---
checkpoint_id: CP-20260724-PHASE5-TARGET-SERVER-ISOLATED-REHEARSAL-GATE-SUBMITTED
task_id: GATE-PHASE5-TARGET-SERVER-ISOLATED-REHEARSAL
status: submitted
recorded_at: 2026-07-24T07:35:29+08:00
branch: codex/phase5-rehearsal-gate
base_commit: c5c1c5e5eff0ee8e3b895772950f52eba61564e5
head_commit: c5c1c5e5eff0ee8e3b895772950f52eba61564e5
supersedes: none
---

# Phase 5 Target-Server Isolated Rehearsal Gate Submitted

## Requested Authorization

请求接受`GATE-PHASE5-TARGET-SERVER-ISOLATED-REHEARSAL`，仅在明确识别并批准的真实目标服务器上执行一次隔离迁移与容量演练

本Gate解锁后允许

- 在批准窗口内由old-key custodian临时交付old production key file
- 在目标服务器私有临时目录生成独立的target encryption key与target HMAC key
- 使用受控production snapshot、现有migration CLI和隔离PostgreSQL执行书籍与章节迁移
- 运行全部8项migration hard validation
- 在独立synthetic capacity database上使用controlled provider执行target-server hard-threshold rehearsal
- 生成private migration manifest、performance report、command audit、secret scan与cleanup evidence

## Required Inputs Before Acceptance

| 输入 | 必须满足 |
| --- | --- |
| Target identity | 明确真实目标服务器hostname或asset identity、Owner与Approver，当前Mac不得被默认视为目标 |
| Server profile | 记录CPU、memory、disk、Node与PostgreSQL版本、clock status和演练时负载 |
| Rehearsal window | 明确开始、结束、值守Owner与hard-stop负责人 |
| Network isolation | 无正式用户流量，无公网入口，PostgreSQL只允许本机或内部网络访问 |
| Snapshot custody | Canonical snapshot fingerprint与private evidence一致，且未超过2026-07-30T21:37:42+08:00 retention deadline |
| Key custody | 明确old-key custodian、三份key的交付方式、临时目录、销毁Owner与销毁时间 |
| Artifact custody | 明确manifest、reports、logs与database的private location、custodian、access revocation、retention deadline和cleanup责任 |

目标服务器身份未明确前，本Gate保持blocked，不得请求old production key或复制snapshot到任何服务器

## Key Boundary

- old、target encryption与target HMAC key必须是三份彼此不同的exact 32-byte files
- 每个key file必须为指定Owner、非symbolic link、`0600`，父目录为`0700`
- key不得出现在命令行值、环境变量值、Git、日志、manifest、report、error或shell history
- CLI只接收file path，old key只能在migration process内存中用于source decrypt与integrity validation
- target keys只用于本次隔离数据库，不得复用未来正式环境key
- migration与validation进程结束后立即销毁全部临时key files并验证不存在工作副本

## Isolated Target State

迁移数据库与容量数据库必须物理或逻辑隔离，不得复用

Migration database允许的初始状态仅为

- 已执行仓库全部schema migrations至`007_advanced_analysis`
- `users`中exactly one active admin，作为migration audit actor
- `books`、`book_sources`、`chapters`以及所有L1、L2、analysis、job、event、outbox与session业务表为zero rows
- 无正式连接、无正式流量、无其他测试数据

Capacity database只允许synthetic scale profile

- 3 books、3000 chapters、70000 facts
- 20 authenticated browse users、10 concurrent submit users
- controlled provider固定返回，不访问real Dify
- single-instance scale lock必须成功取得

任一数据库状态不符合时停止，不得自动删除、清空或修复

## Required Execution

Migration rehearsal必须

- 运行现有`migration:run`并使用private manifest path
- 只迁移books、book_sources与chapters
- 通过`book-count`、`chapter-count`、`metadata`、`source-integrity`、`content-digest`、`target-decrypt`、`target-hmac`与`scope-exclusion`
- 任一decrypt、HMAC、count、metadata或digest差异必须non-zero exit且不得发布最终manifest

Capacity rehearsal必须

- 在记录的idle target-server profile上运行20-user browse、10-user submit与background rebuild priority场景
- 使用nearest-rank p95与原始samples
- browse p95 `<500ms`
- submit p95 `<1000ms`
- status propagation p95 `<2000ms`
- interactive ahead为true且running rebuild step保持uninterrupted

## Private Rehearsal Execution

Migration CLI与scale runner均不得使用repository-local默认output，不得把stdout或stderr发送到普通terminal、CI或session log

执行前必须

- 创建仓库外private run directory，父目录与run directory均为`0700`
- 生成unique rehearsal run ID，设置`umask 077`与shell noclobber
- 使用private non-interactive shell执行，禁用history并禁止command echo
- 确认snapshot link、three key files、migration manifest、migration stdout/stderr、capacity report、Vitest JSON、capacity stdout/stderr、command audit、secret scan、cleanup evidence、run manifest与detached hash paths全部不存在
- fail closed检查全部realpath或待创建parent realpath位于同一private run directory

Migration invocation必须

- 使用private absolute snapshot、key-file与manifest paths
- 使用不含password的local Unix socket或loopback database URL，不得把database credential放入argv
- 将stdout与stderr分别重定向到private `0600` files
- 在private command audit中记录canonical argv、commit、run ID、start、end与exit code
- 禁止继承普通terminal output，禁止existing manifest或log path，禁止在repository写入artifact

Capacity invocation必须

- 将`PHASE5_LOAD_REPORT_PATH`设置为private absolute path
- 将Vitest `--outputFile`设置为另一个private absolute path
- 将stdout与stderr分别重定向到private files，不继承普通terminal output
- 在同一private command audit中记录canonical argv、commit、run ID、start、end与exit code

每个命令结束后必须检查所有新文件为指定Owner、非symbolic link、`0600`且realpath仍在private run directory

Raw `phase5-load-report-v1`保持原始`phase5-local-idle-v1`标签，不得改写或重新标记为target evidence

## Atomic Run Evidence

Controller必须在同一private run directory原子发布一个run-level evidence manifest，至少绑定

- unique rehearsal run ID
- approved target hostname或asset identity
- authorized window start与end
- repository commit SHA与clean status
- migration与capacity exact canonical commands、exit codes、start、end与duration
- snapshot fingerprint、migration manifest与migration stdout/stderr的SHA-256
- capacity raw report、Vitest JSON与capacity stdout/stderr的SHA-256
- command audit、secret scan、key cleanup、database cleanup、snapshot access revocation与artifact inventory evidence的SHA-256
- raw report中的CPU、memory、Node、PostgreSQL、samples、p95、threshold与priority checks
- migration 8项hard validation结果、manifest publication状态、custodian与retention deadline

Run manifest必须先写入同目录`0600`temporary file、flush并fsync，再以no-clobber方式发布final file

Final run manifest发布后，单独计算其SHA-256并通过同样的temporary、flush、fsync、no-clobber流程发布detached hash file；run manifest不得包含自身hash

任一artifact path预先存在、realpath越界、file mode不是`0600`、commit不匹配、target identity不匹配、artifact缺失、hash不匹配或两阶段publication失败时，整次run无效且不得挑选其他artifact替代

## Hard Stops

出现以下任一情况必须立即停止并形成blocked checkpoint

- Target identity、Owner、Approver、window、isolation或custody任一不明确
- Snapshot fingerprint不匹配、retention到期、integrity失败或出现sidecar
- Key mode、Owner、non-symlink、length、distinctness或ephemeral delivery无法证明
- Migration database不是允许的seed state，或capacity database含非synthetic数据
- 任一migration hard validation失败
- 任一capacity threshold或priority check失败
- Migration或capacity output使用repository-local default、普通terminal/CI log、已存在文件或private directory外路径
- Database credential出现在argv，或private shell启用history、command echo或继承普通stdout/stderr
- Run manifest未绑定target identity、window、commit、commands、run ID、exit codes与全部migration、capacity、scan及cleanup artifact fingerprints
- Run manifest与detached hash未按两阶段atomic no-clobber protocol发布
- 发现plaintext、key、credential、真实路径或snapshot fingerprint进入普通日志、artifact或Git
- 需要修改migration semantics、数据库schema、queue policy、threshold、Gate顺序或验收标准

不得通过重跑挑选更好样本、降低阈值、清理正式数据或修改工具语义绕过失败

## Explicitly Still Prohibited

本Gate即使接受也不授权

- 使用real Dify、修改Dify workflow、Prompt或Schema
- 修改Feishu callback、邀请代表用户或执行UAT
- 部署或启动正式服务、创建正式数据库、开放公网或正式流量
- 将rehearsal database、snapshot、keys、manifest或artifact晋升为正式环境
- 停止旧服务、切换入口、traffic switch、cutover或旧备份销毁

## Cleanup And Evidence

演练结束或hard stop后必须

- 立即销毁三份临时key files及其工作副本
- 撤销执行者对snapshot的访问，并按既有retention deadline保管或提前销毁
- 删除隔离migration与capacity databases，保留销毁证据
- 删除含正式数据或敏感路径的临时logs与working artifacts
- 只在private evidence中暂存snapshot fingerprint、真实路径、server identity、manifest与完整raw reports
- Git checkpoint只记录PASS/FAIL、非敏感server profile摘要、threshold结果、manifest存在性和cleanup状态

Private evidence bundle必须由唯一custodian保管，执行者在run结束时撤权

Manifest、wrapper、raw reports、stdout、stderr、command audit、secret scan与cleanup evidence的retention deadline为结果Gate明确接受或拒绝、演练取消、或rehearsal结束后7个自然日中的最早时间

到期必须验证销毁private evidence及全部工作副本；若结果Gate尚未决策，则本次evidence过期，后续不得据此接受Gate

## Current Evidence

- [Production snapshot acquisition accepted](CP-20260723-PHASE5-PRODUCTION-SNAPSHOT-ACQUISITION-ACCEPTED.md)
- Migration tools与local scale correctness已通过Phase 5 tools Gate
- Target server尚未识别，old production key未请求，rehearsal未执行

## Decision Required

请用户先明确真实目标服务器，再明确接受或拒绝`GATE-PHASE5-TARGET-SERVER-ISOLATED-REHEARSAL`

## Recommended Next Action

识别target identity并接受本Gate后，总控重新验证snapshot retention与private evidence，再开始受控old-key delivery和isolated rehearsal

在此之前保持old key、snapshot transfer、migration、capacity rehearsal与所有later Gates locked
