---
decision_id: DEC-0004
status: accepted
recorded_at: 2026-07-19T21:26:43+08:00
confidence: high
scope: local-dify-smoke-credentials
supersedes: none
---

# Dify Smoke Credential Policy

## Context

用户在本地 `dify-workflows/Dify-key.md` 提供五组 Dify Workflow URL 与 Key，并明确授权开发过程中在需要时调用真实凭证测试，同时要求将该授权写入项目唯一信源

凭证文件不属于项目配置基线，也不得成为线程上下文、Git 历史、CI secret 或项目文档的一部分

## Decision

- 总控 Agent 可在已批准 task contract 需要真实连通性证据时，使用本地 `dify-workflows/Dify-key.md` 执行显式非生产 smoke
- smoke 只能使用合成、非敏感、最小输入，不得使用正式小说正文、正式事实、用户数据或生产数据库
- 真实请求必须人工或本地脚本显式触发，普通单测、CI、应用启动和 production code path 必须默认不读取该文件、不发真实请求
- 凭证值、哈希、长度、前后缀、Authorization header、完整 URL、请求正文和 provider 原始响应不得进入 Git、项目源、checkpoint、日志、测试快照、PR、终端摘要或 Agent 消息
- 允许记录的证据仅限 manifest target、成功或脱敏错误码、HTTP 分类、耗时、contract 校验结果和执行时间
- 凭证只在发起请求的进程内临时注入，命令结束后不得写入 `.env`、shell profile、缓存、数据库或其他持久文件
- `dify-workflows/Dify-key.md` 必须保持 Git ignored，本机权限保持 owner read/write only
- 每组 URL/Key 必须先与 manifest target 建立明确映射；禁止按文件顺序、Key 外观或线程记忆推断 target
- smoke 失败不得自动轮换其他 Key 或扩大请求范围；只报告稳定脱敏错误并停止

## Evidence

- 用户于 2026-07-19 明确授权开发过程中按需调用真实 Key，并要求写入项目信源
- 总控只检查到文件存在、包含五组 `url`/`Key` 字段，未读取、输出或记录任何凭证值
- 文件在治理变更前未被 Git 跟踪且未被 ignore，权限为 owner/group/others readable
- 总控已将文件加入 `.gitignore`，并将本机权限收紧为 owner read/write only
- 当前五组记录没有可机器识别的 target 标签，因此真实 smoke 保持阻塞，直到 target 映射明确

## Consequences

- 后续 Agent 必须从本 decision 获取凭证使用边界，不能仅依赖线程授权
- 真实 smoke 可以补充环境连通性证据，但不能替代 fake、contract、恢复、幂等或数据库测试
- target 映射明确后属于本 decision 内的可逆测试操作，无需新增架构或安全策略决策
- 任何把凭证纳入 Git、CI、正式配置、部署或长期 secret storage 的需求均超出本 decision，必须暂停并重新确认

## Source

本决策来源于用户在 2026-07-19 对本地 Dify Workflow Key 测试使用的明确授权，以及总控对凭证文件跟踪状态、权限和字段结构的脱敏核验
