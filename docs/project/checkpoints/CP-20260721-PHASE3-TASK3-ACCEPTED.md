---
checkpoint_id: CP-20260721-PHASE3-TASK3-ACCEPTED
task_id: PHASE3-TASK3
status: accepted
recorded_at: 2026-07-21T11:25:01+08:00
branch: codex/phase3-task3-recall-policy
base_commit: ef6d3daa286871f99360d5544cf9a4deb018f604
head_commit: 6042647bbc2f41b0b6e9f3f3aca9fbf222aa6089
supersedes: none
---

# Phase 3 Task 3 Accepted

## Scope

接受确定性 Query intent 解析、全章节窗口 recall policy、全局预算、稳定排序、逐项排除原因和 legacy golden fixture

实际 implementation scope 严格限定为 Started Contract 批准的六个文件，无 mechanical adjacent 文件扩张

## Evidence

### Implementation Agent

- 初始 RED：两个新 Query suite 因 `intent.js` 缺失而失败，既有 domain 137 tests 通过
- 初始实现提交 `4c467007cf8f15e7f92153d4e646c42d78419c71`
- intent 与 recall priority 修复提交 `7297f0e65b1bafefc4588c6224031834f535e91c`
- duplicate fact ID 与确定性 subject match 修复提交 `6042647bbc2f41b0b6e9f3f3aca9fbf222aa6089`
- 最终 focused 161 tests、domain 154 tests、legacy 112/112、typecheck、lint 和 diff check 通过

### Specification Review

- final verdict: APPROVED
- 初审发现 related keyword score 可越过 target 与显式主体集合问法丢失 target 两项 Important，均以回归 RED 修复
- 最终确认旧回答不进入签名或 runtime，指代只读取最近三轮用户问题
- 最终确认三类 intent、宽泛集合无假目标、全窗口扫描、late target、全局预算、稳定排序与逐项排除原因符合契约
- quality corrections 后再次复验通过，无规格回归

### Code Quality Review

- final verdict: APPROVED
- 初审发现重复 fact ID 可突破预算与 subject 输入顺序可使短 alias 抢占完整 display name 两项 Important，均已关闭
- duplicate fact ID 在 scoring 与预算前使用稳定非敏感错误快速失败
- subject match 按最长文本、display name 优先和 `subjectKey` lexical order 确定性决胜
- residual risk 为当前实体识别仍是确定性字符串规则，不包含语义消歧，符合本 task 边界

### Controller Verification

- `npm run verify:controller` 通过
- legacy 112/112
- new 288 passed with 1 configured smoke skipped
- integration 223/223
- workspace 5/5、contracts 7/7、project source 42/42、manifest、lint、typecheck 和 legacy build 均通过
- `npm run test:phase1:e2e` 通过 2/2
- `npm run test:phase2:e2e` 通过 6/6
- `npm run typecheck:phase2` 通过
- `npm run build -w apps/web` 通过
- `git diff --check` 通过

### Scope Audit

- implementation diff 仅包含两个 Query policy、两个直接测试、domain export 和 Phase 3 golden fixture
- 未修改 database、schema、migration、API、jobs、Worker、Web、Dify YAML/manifest、凭证、依赖或 lockfile
- 未修改现有 Query public contract，未实现 Task 4-7、Phase 4、Gate、正式数据、部署或切换
- previous answer 字段不存在于 intent 函数签名，runtime 注入不会进入 intent 或 recall data

## Accepted Result

PHASE3-TASK3 implementation accepted at `6042647bbc2f41b0b6e9f3f3aca9fbf222aa6089` and may proceed to PR and CI verification under DEC-0002

Task 4 remains locked until the implementation PR is merged, a merged checkpoint is accepted and the project source names the new main SHA
