---
decision_id: DEC-0022
status: accepted
recorded_at: 2026-07-24T23:55:34+08:00
confidence: high
scope: phase5-real-retry-execution-closure
supersedes: none
---

# Phase 5 Single Artifact Rehearsal Stage

## Context

Real retry execution identity完成focused规格验证后，独立质量审查确认当前approved implementation baseline没有tracked且可直接执行的统一JavaScript stage

现有database migration需要TypeScript compiler生成ignored dist，migration CLI需要Vite生成ignored dist，capacity command通过Vitest与node_modules dependency graph执行

因此仅固定Git commit与npm script名称不能冻结最终执行bytes，也不能关闭verified-bytes与TOCTOU quality findings

## Decision

- 采用blocked checkpoint中的Option A
- 仓库新增一个Phase 5 rehearsal专用stage module
- Stage source只组合现有database initialization、migration、8项hard validation与capacity contract，不改变这些行为的业务语义
- Build生成并提交一个单文件Node ESM artifact
- Artifact运行时不得调用npm、tsc、Vite、Vitest或按repository path加载node_modules
- Artifact必须具有可复现构建检查、源与artifact行为对齐测试及稳定SHA-256
- Real retry exact identity只允许执行经过Gate接受的artifact bytes
- 新stage只服务Phase 5 isolated rehearsal，不成为通用deployment framework或产品API

## Scope Boundary

- Core modules：`scripts/phase5-rehearsal-stage/**`的source、build config与committed artifact
- Mechanical adjacent scope：root package scripts、direct contract tests、artifact reproducibility与hash checker
- 不新增外部依赖，使用仓库已存在的Node、TypeScript与Vite toolchain完成开发时构建
- 不修改migration或database Schema语义、capacity dataset、threshold、priority、Gate顺序或验收标准
- 不读取production snapshot、old key或Keychain，不创建真实database，不访问Dify、飞书或部署环境

## Consequences

- 开发与CI仍可使用现有toolchain生成并校验artifact
- Real retry runtime closure收敛为system Node与单一accepted artifact
- Artifact任何源码、依赖或构建变化都会改变bytes并要求重新审查与冻结
- Stage implementation通过独立规格与质量审查后，real retry identity仍需重新生成和双审
- 本决策不构成Execution confirmation，不授权任何真实输入或真实rehearsal

## Evidence

- [Real retry identity quality blocked](../checkpoints/CP-20260724-PHASE5-REAL-RETRY-IDENTITY-QUALITY-BLOCKED.md)
- 用户于`2026-07-24`明确选择Option `A`

## Source

用户于`2026-07-24`明确回复`A`，接受blocked checkpoint中的Option A

## Accepted Result

接受单一committed Node ESM artifact作为Phase 5 rehearsal执行闭包

只解锁无真实输入的stage implementation、focused verification与独立审查
