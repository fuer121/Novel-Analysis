---
checkpoint_id: CP-20260726-PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-CONTROLLER-PROTOCOL-CORRECTION-V2-BLOCKED-DISPOSITION-SUBMITTED
task_id: PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-CONTROLLER-PROTOCOL-CORRECTION-V2-BLOCKED-DISPOSITION
status: submitted
recorded_at: 2026-07-26T23:03:00+08:00
branch: codex/phase5-readonly-snapshot-diagnostic-protocol-v3-disposition
base_commit: e7fd51eea4789d968bec416fd53a7be2f15c96a8
head_commit: e7fd51eea4789d968bec416fd53a7be2f15c96a8
supersedes: none
---

# Phase 5 Read-Only Snapshot Diagnostic Controller Protocol Correction V2 Blocked Disposition Submitted

## Scope

提交controller protocol correction V2被独立规格与质量pre-cleanup双审判定`BLOCKED`后的处置方案

本Gate只请求授权一个新的repository-external、synthetic-only controller protocol correction V3，用于关闭不可延长24小时deadline未被强制以及descriptor关闭后raw seal顺序存在异常窗口两个blocking finding

本Gate不授权提前清理V2 retained evidence，不授权读取真实config、snapshot、old key或Keychain，不生成target keys，不连接Docker或database，不修改accepted candidate，也不授权真实diagnostic、UAT、部署、切换或retry

## Current Custody

- V2 blocked result与deadline custody checkpoint均已通过CI并合并
- V2 attempt phase保持`executed`
- Specification与quality pre-cleanup verdict均为failed
- 三项raw sinks保持exact-zero owner-owned `0400`并匹配state-recorded digests
- 四个cleanup targets保持pending
- Hard custody deadline为`2026-07-27T20:33:34.789+08:00`
- 一次性deadline cleanup恢复已激活
- Deadline前不得销毁V2 raw evidence或private reference
- Deadline到达时必须使用V2 frozen cleanup path销毁exact targets并保持`BLOCKED`
- V2 synthetic attempt不得补跑，V2 frozen identity不得修改

## Recommended Disposition

放弃blocked V2 protocol作为可接受controller identity，创建独立V3 root与全新frozen identity，同时保持accepted 8-member candidate、diagnostic语义、owner-only权限与fail-closed边界不变

- Constructor必须使用协议固定且不超过24小时的retention，并拒绝负数、零值、非finite与超过上限的retention
- Resume必须重新验证`deadlineAt`不早于`startedAt`且不晚于`startedAt + 24h`，拒绝持久化deadline延长、回拨或非canonical timestamp
- Raw descriptors关闭后必须先完成三项raw sinks的owner-readable `0400` seal、stat与digest atomic publication，再允许创建或写入private reference
- Raw seal任一步骤异常必须保持fail-closed custody state，不得进入reference publication或review-ready状态
- Reference write、chmod、stat或digest异常不得使已关闭descriptor的raw sinks保持owner-writable
- V2其余accepted protocol边界、diagnostic chain、reviewer independence、passed-only cleanup与五维fresh observation规则保持不变

## Task Contract

- Task ID：`PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-CONTROLLER-PROTOCOL-CORRECTION-V3`
- Core allowed modules：repository-external synthetic controller protocol V3、deadline creation与resume validation、raw seal ordering、reference publication、atomic custody state与focused tests
- Mechanical adjacent scope：synthetic fixtures、exception injection、fake clock、new frozen manifest、sanitized evidence schema、review registrar与exact-target cleanup proof
- Base commit：`e7fd51eea4789d968bec416fd53a7be2f15c96a8`
- Base identity：V2 blocked checkpoint、V2 deadline custody checkpoint、accepted 8-member candidate与V2 frozen evidence只读基线；不得修改或补跑V2 identity
- Success criteria：关闭两个consolidated Important findings，strict TDD与完整synthetic protocol unit通过，新V3 frozen identity完成唯一synthetic attempt、pre-cleanup双审、受控cleanup、五维post-cleanup双审且无Critical、Important或阻塞finding
- Prohibited changes：V2 retained evidence提前cleanup、真实输入或runtime访问、accepted candidate或权限修改、diagnostic allowlist修改、snapshot写入或修复、key访问、Docker、database、migration、capacity、Dify、飞书、UAT、部署、切换、cutover或retry
- Required verification：retention bounds、persisted deadline tampering、clock rollback、descriptor-close-immediate-seal、raw seal exception、reference operation exception、atomic resume、existing V2 protocol matrix、sensitive-data scan、独立规格与质量双审
- Escalation conditions：任一V2 custody冲突、真实输入需求、candidate或Gate语义变化、raw custody超期、Critical、Important、阻塞finding或证据冲突必须停止

## Corrected Protocol Boundary

1. V3必须使用新的repository-external root与新frozen identity，不得原地修改V2文件或attempt state
2. V2 retained evidence必须由既有frozen cleanup path在hard deadline到达后独立cleanup，V3不得消费或销毁V2 evidence
3. Attempt创建时必须验证固定retention bounds并atomic记录canonical `startedAt`与不可延长deadline
4. Resume必须重新计算最大deadline并拒绝任何超限、回拨、非canonical或不一致state
5. Child descriptors关闭后必须先seal全部raw sinks、核验owner/mode/type并atomic发布digests
6. Raw custody seal完成后才允许创建private reference，reference阶段任一异常都必须保留已sealed raw custody并可恢复
7. 两位独立reviewer必须基于同一V3 frozen manifest与相同raw digests完成pre-cleanup review
8. Deadline前只有两项review都passed才能cleanup；deadline到达时必须cleanup并保持`BLOCKED`
9. Cleanup后必须完成process、file、key、local TCP与task-owned runtime五维fresh observation及独立双审

V3 correction通过完整双审后只能创建correction result checkpoint，不得自动提交或执行新的read-only snapshot diagnostic Gate、UAT、Deployment Gate或Cutover Gate

## Evidence

- V2 blocked checkpoint记录2个consolidated Important findings
- Specification review独立复现deadline validation与raw seal ordering缺口
- Quality review独立复现deadline validation缺口
- V2 focused protocol虽为`34/34 PASS`，但未覆盖persisted deadline extension与reference-operation-before-seal异常
- PR #220与PR #221的`CI/verify`均通过并已合并
- `main`与`origin/main`在本submission创建前同步于`e7fd51eea4789d968bec416fd53a7be2f15c96a8`且clean
- `npm run controller:health`fresh通过并报告0个dirty worktree
- 本submission未读取raw bytes、private pointer value、candidate bytes或真实路径
- 本submission未访问任何真实输入、Docker、database、Dify、飞书或部署环境

## Required Confirmation

只有用户在本submission PR通过CI并合并后明确回复以下准确Gate名称，才授权启动新的synthetic-only V3 correction

`接受 GATE-PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-CONTROLLER-PROTOCOL-CORRECTION-V2-BLOCKED-DISPOSITION`

任何简称、继续推进、部署请求或旧Gate确认都不能替代该named confirmation

## Acceptance Request

请求用户在submission PR合并后决定是否接受`GATE-PHASE5-READONLY-SNAPSHOT-DIAGNOSTIC-CONTROLLER-PROTOCOL-CORRECTION-V2-BLOCKED-DISPOSITION`

接受该Gate只解锁repository-external synthetic-only V3 correction；真实diagnostic、目标服务器演练、飞书UAT、部署与切换继续locked
