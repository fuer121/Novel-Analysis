---
decision_id: DEC-0024
status: accepted
recorded_at: 2026-07-25T11:32:06+08:00
confidence: high
scope: phase5-real-retry-database-resource-ownership
supersedes: none
---

# Phase 5 Launcher Owned PostgreSQL Lifecycle

## Context

Identity v3无法证明既有database URL对应的container、volume与network归本次launcher所有

从普通config接受cleanup resource name会产生删除任意本机Docker资源的能力，不满足Gate安全边界

## Decision

- 采用resource ownership blocked checkpoint中的Option R1
- Launcher创建并只清理本轮创建的migration与capacity PostgreSQL资源
- PostgreSQL image固定为仓库现有digest `postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193`
- Migration与capacity分别使用独立container、volume与network，不共享database resource
- 每次执行生成random 128-bit run ID与独立random database password，不从普通config接收credential
- Credential只通过private child environment与inherited descriptor交付，不进入argv、ordinary output、Git或retained sanitized evidence
- Container只通过Docker动态端口绑定到`127.0.0.1`，禁止`0.0.0.0`、LAN或固定host port
- Database URL只由固定user/database、Docker inspect确认的loopback port与本轮credential构造
- Resource name使用固定prefix、run ID与role构造，不允许config覆盖
- 每个container、volume与network创建时写入ownership label
- Launcher记录Docker返回的immutable resource ID与expected ownership label
- Cleanup前必须重新inspect并同时匹配resource ID、name、role与ownership label；任何mismatch停止并形成blocked cleanup evidence，不得删除
- Fresh absence在创建前和cleanup后覆盖container、volume、network、PID、file与local TCP

## Lifecycle Order

1. 验证Docker CLI identity、image digest与所有expected resource absence
2. 生成run ID与private credentials
3. 分别创建migration与capacity network、volume与container
4. Inspect并绑定immutable IDs、ownership labels与loopback dynamic ports
5. 通过inherited descriptors向stage交付两个database URL
6. 无论成功或失败均按container、volume、network顺序执行ownership-checked cleanup
7. Cleanup与fresh absence全部成功后才允许发布PASS evidence

## Scope Boundary

- 只修改repository-external identity draft与candidate
- 只使用synthetic stub验证Docker command、inspect parser、ownership、failure cleanup与absence
- 本决策不授权连接Docker daemon、拉取image、创建database或执行real rehearsal
- 不修改migration、Schema、capacity contract、Gate顺序或验收标准

## Consequences

- Real retry不再接受外部已有database URL或可配置cleanup resource name
- Image digest或resource lifecycle变化必须重新冻结identity并双审
- Cleanup ownership证据冲突时必须保留blocked结果并请求人工处理，不得强制删除

## Evidence

- [Identity v3 resource ownership blocked](../checkpoints/CP-20260725-PHASE5-REAL-RETRY-IDENTITY-V3-RESOURCE-OWNERSHIP-BLOCKED.md)
- Repository现有[compose.yaml](../../../compose.yaml)固定相同PostgreSQL digest

## Source

用户于`2026-07-25`明确选择Option `R1`

## Accepted Result

接受launcher-owned PostgreSQL lifecycle及上述最小ownership、credential、port、naming与URL策略

只解锁synthetic stub implementation与独立双审，真实Docker、database与real retry继续locked
