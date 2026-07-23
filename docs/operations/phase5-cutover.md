# Phase 5 切换清单

本清单只记录切换决策所需输入，不授权维护模式、迁移、部署、入口变更或流量切换

| 字段 | 必填内容 |
| --- | --- |
| Owner | 切换指挥、迁移负责人、应用负责人、数据库负责人及观察期负责人 |
| Approver | 正式切换 Gate 审批人 |
| Input | 全部前置 Gate、旧系统 live task 为零、不可变备份、空 PostgreSQL、迁移硬校验、基础 smoke 与两小时窗口计划 |
| Evidence | 前置 Gate、计时记录、备份指纹、迁移报告、硬校验、smoke、入口变更审批与两小时观察记录 |
| Hard stop | 前置 Gate 缺失、live task 非零、备份或硬校验失败、两小时窗口超时、smoke 失败或观察负责人缺席时取消切换 |
| Gate dependency | 快照、目标服务器演练、UAT 与部署 Gate 全部通过后，单独申请正式切换 Gate |
