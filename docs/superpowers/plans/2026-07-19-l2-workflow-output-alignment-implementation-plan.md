# L2 Workflow Output Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让仓库 L2 Workflow 输出可信章节绑定字段和 facts，并使真实 smoke timeout 覆盖三个顺序 Dify 调用

**Architecture:** 保持 accepted adapter contract 与 normalizer 不变，在 L2 Workflow 的既有规范输出节点中用开始节点输入注入章节号和标题，只从模型 JSON 读取 facts。End 节点继续输出 result string，用户后续手动导入 DSL 后再执行真实 smoke

**Tech Stack:** Dify Workflow YAML、Python code node、Node test runner、Vitest、SHA256 manifest

---

## Approval And Boundaries

用户已明确选择方案 A，并授权修改仓库 L2 Workflow YAML。该授权不包含线上 Dify 发布，仓库变更不能表述为线上已生效

禁止修改其他四个 Workflow、accepted Dify contract、normalizer、Prompt、事实语义、数据库、API、Worker、正式数据、部署或切换

## Task 1: Align L2 Workflow Output And Smoke Timeout

**Files:**

- Create: `test/contracts/l2-workflow-output.contract.test.js`
- Modify: `dify-workflows/l2-fact-index.workflow.yml`
- Modify: `dify-workflows/manifest.json`
- Modify: `packages/dify/src/http-adapter.test.ts`

- [ ] **Step 1: Write the failing repository contract test**

Create a Node test that reads only the L2 YAML and smoke test source. Lock assertions to the existing node IDs so unrelated matching text cannot pass

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const root = new URL("../../", import.meta.url);

test("L2 workflow binds trusted chapter context around model facts", async () => {
  const workflow = await fs.readFile(new URL("dify-workflows/l2-fact-index.workflow.yml", root), "utf8");
  const outputNode = workflow.match(/    - data:\n        code: \|[\s\S]*?\n      id: '2000000000103'/)?.[0] ?? "";

  assert.match(outputNode, /def main\(text: str, chapter_index: int, chapter_title: str\):/);
  assert.match(outputNode, /"chapter_index": int\(chapter_index\)/);
  assert.match(outputNode, /"chapter_title": chapter_title or ""/);
  assert.match(outputNode, /"facts": parsed\.get\("facts"\)/);
  assert.match(outputNode, /- '2000000000101'\n          - chapter_index/);
  assert.match(outputNode, /- '2000000000101'\n          - chapter_title/);
});

test("real Dify smoke allows three sequential provider timeouts", async () => {
  const source = await fs.readFile(new URL("packages/dify/src/http-adapter.test.ts", root), "utf8");
  assert.match(source, /calls all three targets with synthetic non-sensitive inputs[\s\S]*?\}, 200_000\);/);
});
```

- [ ] **Step 2: Confirm RED**

Run:

```bash
node --test test/contracts/l2-workflow-output.contract.test.js
```

Expected: both tests fail because node `2000000000103` only accepts `text` and the smoke test uses Vitest's default timeout

- [ ] **Step 3: Implement the minimum Workflow output wrapper**

Change only code node `2000000000103`

```python
def main(text: str, chapter_index: int, chapter_title: str):
    import json
    import re

    raw = (text or "").strip()
    raw = re.sub(r"^```(?:json)?", "", raw).strip()
    raw = re.sub(r"```$", "", raw).strip()

    try:
        parsed = json.loads(raw)
        if not isinstance(parsed, dict) or not isinstance(parsed.get("facts"), list):
            return {"result": raw}
        result = {
            "chapter_index": int(chapter_index),
            "chapter_title": chapter_title or "",
            "facts": parsed.get("facts"),
        }
        return {"result": json.dumps(result, ensure_ascii=False)}
    except Exception:
        return {"result": raw}
```

Add two code-node variables using existing start node `2000000000101`

```yaml
        - value_selector:
          - '2000000000101'
          - chapter_index
          value_type: number
          variable: chapter_index
        - value_selector:
          - '2000000000101'
          - chapter_title
          value_type: string
          variable: chapter_title
```

Do not change the LLM node, End node, edges or coordinates

- [ ] **Step 4: Set a smoke-only timeout**

Change only the smoke `it` declaration in `packages/dify/src/http-adapter.test.ts`

```ts
  it("calls all three targets with synthetic non-sensitive inputs", async () => {
    // existing smoke body unchanged
  }, 200_000);
```

Do not change the adapter's 60 second per-request timeout or regular Vitest defaults

- [ ] **Step 5: Verify GREEN and regenerate the manifest**

Run:

```bash
node --test test/contracts/l2-workflow-output.contract.test.js
npm run dify:manifest
npm run dify:manifest:check
```

Expected: 2/2 contract tests pass and the manifest matches all five Workflow files

Inspect the manifest diff and confirm only `workflows.l2_index.sha256` changes

- [ ] **Step 6: Run required verification**

```bash
npm run test -w packages/dify
npm run typecheck -w packages/dify
npm run verify:new
npm run verify:legacy
npm run test:project-source
npm run project:check
npm run lint
git diff --check
```

Expected: all commands pass; the env-gated real smoke remains skipped when explicit credentials are absent

Run the scope audit against the controller-provided base commit

```bash
git diff --name-status "$BASE" HEAD
git diff --exit-code "$BASE" HEAD -- dify-workflows/analysis-chapter.workflow.yml dify-workflows/analysis-summary.workflow.yml dify-workflows/minimal-chapter-fetch.workflow.yml dify-workflows/l1-route-index.workflow.yml packages/contracts packages/dify/src/http-adapter.ts
```

Expected: exactly the four allowed files change and protected paths have no diff

- [ ] **Step 7: Commit**

```bash
git add test/contracts/l2-workflow-output.contract.test.js dify-workflows/l2-fact-index.workflow.yml dify-workflows/manifest.json packages/dify/src/http-adapter.test.ts
git commit -m "fix: align L2 workflow output contract"
```

**Acceptance:** 仓库 L2 DSL 严格输出 chapter_index、chapter_title、facts；章节字段来自 Workflow 输入；非法模型输出继续 fail-closed；smoke timeout 为 200 秒；manifest 仅更新 L2 hash；全部验证通过；未发布线上 Workflow

## Controller Governance After Review

实现通过规格审查、质量审查和总控验证后，总控创建新的 accepted decision 记录本次用户授权，不修改原 accepted decision 或 checkpoint

项目源必须保留“用户尚未导入 DSL，线上 L2 smoke 仍未通过”的状态。只有用户完成导入并重新 smoke 后才能移除该 blocker
