---
checkpoint_id: CP-20260725-PHASE5-REAL-RETRY-IDENTITY-V3-RESOURCE-OWNERSHIP-BLOCKED
task_id: PHASE5-REAL-RETRY-IDENTITY
status: accepted
recorded_at: 2026-07-25T11:00:09+08:00
branch: codex/phase5-identity-v3-blocked
base_commit: 4f9c650fa1170dc2c23ac82adf672810ebc0b13b
head_commit: 4f9c650fa1170dc2c23ac82adf672810ebc0b13b
supersedes: none
---

# Phase 5 Real Retry Identity V3 Resource Ownership Blocked

## Scope

记录identity v3在无真实输入的实现与规格审查中关闭stage interface、bootstrap、containment与manifest primitive后，因database resource ownership无法满足统一cleanup Gate而停止

本checkpoint只接受blocked事实，不接受任何candidate SHA，不授权真实input、database、Docker或real retry

## Evidence

- Repository `main`与`origin/main`均为`4f9c650fa1170dc2c23ac82adf672810ebc0b13b`且clean
- Accepted stage artifact SHA保持`acedef876bc35821ac0e708660d3ddc1d373d30eb97dc15fdc9846f863cc71d5`
- Stage source integration使用独立Phase 5 config通过9/9，`phase5:stage:check`通过
- Identity首版focused 12/12通过，但规格审查发现2个Critical与3个Important并拒绝candidate
- Wrapper stdin执行缺口已修复，真实process success且ordinary stdout/stderr均为空
- 单一非循环bootstrap已证明：外部system verifier先核验固定Perl runtime与bootstrap，再通过same-fd bytes依次交付wrapper与entry
- Parent/root/leaf fd identity与parent swap reproduction通过
- Original manifest bytes、sidecar、digest与provenance独立复算primitive通过
- PID、file、local TCP、strict Docker container、volume、network absence plan与stub validation通过
- 修正后focused 7/7通过
- 未访问production snapshot、old key、Keychain、真实database、Docker daemon、network、Dify或飞书

## Blocking Finding

当前launcher只接受已存在的migration与capacity database URL，不创建其container、volume或network

因此launcher无法证明cleanup目标由本次执行创建，也无法证明在`finally`删除这些资源不会影响用户本机其他Docker资源

从config直接接受待删除resource name会形成任意资源删除能力，不符合Gate安全边界

改为launcher-owned PostgreSQL lifecycle需要新增并固定以下策略

- PostgreSQL image digest
- Database credential delivery
- Host port allocation
- Container、volume与network命名
- Database URL construction与resource ownership binding

这些属于数据与安全策略变化，超出既有task contract，必须暂停确认

## Candidate Status

- 首版frozen candidate已移动为`phase5-real-retry-identity-v3-rejected-spec`，继续invalid
- 新修复只保留在repository-external draft，未freeze、没有accepted SHA或trust root
- Draft不得用于Execution confirmation或real retry
- 旧v2 candidate未修改

## Prohibited Changes Audit

- 未修改repository product code、migration、Schema、capacity threshold、Gate顺序或验收标准
- 未创建、检查、连接或删除任何真实Docker、database、container、volume或network
- 未读取、复制、hash或解密production snapshot、old key或credential
- 未执行real retry或自动重试

## Decision Required

### Option R1

授权launcher-owned Docker PostgreSQL lifecycle，并由后续decision固定image digest、credential、port、resource naming与URL construction策略

### Option R2

由外部orchestrator创建资源并提供不可伪造的ownership attestation、限定cleanup capability与fresh absence evidence，launcher不得从普通config接受任意resource name

总控推荐R1

R1的所有权链更直接，执行单元可以证明资源由自己创建并只删除自己创建的资源；R2需要额外orchestrator与attestation协议，复杂度更高

## Risks And Blockers

- R1涉及Docker lifecycle与database credential安全策略，必须单独批准
- R2会引入新的外部trust boundary与attestation协议
- 在用户明确选择前，identity preparation保持blocked

## Accepted Result

接受identity v3因database resource ownership无法证明而blocked

不接受当前candidate，Execution confirmation、真实输入与real retry继续locked

## Recommended Next Action

用户明确选择R1或R2后，先形成最小decision与task contract，再继续无真实输入的identity修正和双审
