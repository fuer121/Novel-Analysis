---
checkpoint_id: CP-20260723-PHASE5-TASK6-QUALITY-BLOCKED
task_id: PHASE5-TASK6
status: accepted
recorded_at: 2026-07-23T17:05:43+08:00
branch: codex/phase5-task6
base_commit: 66e1f4d5d4ea98b611dc6556c748234e077f82a3
head_commit: fb803dbcc4bdf7da468591d6776acdcce8bd834b
supersedes: none
---

# Phase 5 Task 6 Quality Blocked

## Scope

记录PHASE5-TASK6独立质量审查发现的benchmark host-isolation证据冲突

## Review Verdict

`QUALITY_BLOCKED`

## Findings

### Important: Host Isolation Contract Missing

- 单独运行相同scale命令时browse p95为287.964ms并PASS
- 两条相同scale命令并行运行时，两份raw report均正常生成但browse p95分别为963.839ms与1025.618ms并FAIL
- 三次report记录的server profile相同，当前schema无法表达benchmark是否独占执行或宿主是否存在争用
- reproduction文档没有可验证的single-instance、idle-host、dedicated runner或CI isolation前置条件
- Task 6合同要求threshold失败或local/CI evidence conflict时暂停升级，因此不得接受implementation

### Minor: Background Startup Timeout Not Cleared

- `startBackgroundRebuild`成功进入barrier后10秒timeout仍保持active
- 应保存timer handle并在`finally`清理，避免repeated-run资源噪声

## Evidence

- Specification review：`SPEC_COMPLIANT`
- Quality isolated run：browse p95 287.964ms，PASS
- Quality concurrent run A：browse p95 963.839ms，FAIL
- Quality concurrent run B：browse p95 1025.618ms，FAIL
- Phase 5 3/3、integration 439/439、typecheck、lint、full verify与diff check均通过
- 最终临时database count为0，未确认其他cleanup泄漏

## Prohibited Changes Audit

审查期间未修改文件；未降低threshold、未修改production、migration、index、cache、queue policy、真实Dify、生产流量、正式数据、部署或切换

## Decisions Required

需要用户确认采用专用空闲本地benchmark与single-instance fail-closed约束、建设dedicated CI runner，或保持Task 6 blocked

## Accepted Result

PHASE5-TASK6保持blocked；implementation commit `fb803db`不得进入acceptance/PR；Task 7、Task 8与所有正式操作保持锁定
