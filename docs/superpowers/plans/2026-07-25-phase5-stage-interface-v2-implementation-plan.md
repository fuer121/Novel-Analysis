# Phase 5 Stage Interface V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking

**Goal:** 让single-artifact stage从launcher已验证的descriptor或bytes消费敏感输入，并对migration与capacity资源进行双向ID绑定

**Architecture:** Stage以inherited descriptor作为敏感输入边界，读取后不再按原始path reopen。SQLite需要path时，在stage-owned private temporary directory内从verified bytes建立一次性working copy并在结束时清理；migration package只增加直接消费verified key bytes所需的最小入口。Migration与capacity的opaque resource ID贯穿request与result并在不匹配时fail closed

**Tech Stack:** Node.js ESM、TypeScript、Vitest、Vite、Node test runner

---

### Task 1: Verified Input And Resource Contract

**Files:**
- Modify: `scripts/phase5-rehearsal-stage/src/stage.ts`
- Modify: `test/phase5/rehearsal-stage.integration.test.ts`
- Modify: `test/contracts/phase5-rehearsal-stage.test.js`

- [ ] **Step 1: Write failing tests for descriptor-only request and sensitive inputs**

覆盖request与敏感input只接受inherited descriptor、同一descriptor被读取、path字段被拒绝、descriptor缺失或无效时使用sanitized code fail closed

- [ ] **Step 2: Write failing tests for resource binding**

覆盖migration与capacity的非空opaque resource ID进入request和passed/failed result、ID不匹配时fail closed、ID不得由secret或private path派生

- [ ] **Step 3: Run focused RED verification**

Run: `npx vitest run test/phase5/rehearsal-stage.integration.test.ts && node --test test/contracts/phase5-rehearsal-stage.test.js`

Expected: 新增descriptor与resource binding assertions因v1接口缺失而失败

- [ ] **Step 4: Implement the minimal v2 request and result contract**

只实现descriptor读取、严格request validation、resource ID透传与mismatch拒绝，保持既有mode dispatch、sanitized failure和atomic result publish行为

- [ ] **Step 5: Run focused GREEN verification**

Run: `npx vitest run test/phase5/rehearsal-stage.integration.test.ts && node --test test/contracts/phase5-rehearsal-stage.test.js`

Expected: PASS

### Task 2: Verified Migration Bytes And SQLite Custody

**Files:**
- Modify: `packages/migration/src/cli.ts`
- Modify: `packages/migration/src/cli.test.ts`
- Modify: `scripts/phase5-rehearsal-stage/src/stage.ts`
- Modify: `test/phase5/rehearsal-stage.integration.test.ts`

- [ ] **Step 1: Write failing tests for verified key bytes**

覆盖migration入口直接接收三个32-byte key Buffer、保持key distinct与admin检查，不再要求stage提供可重开的key path

- [ ] **Step 2: Write failing tests for SQLite custody and cleanup**

覆盖source bytes只写入mode `0600`的stage-owned temporary directory、migration只接收该working copy、成功与失败均删除working copy和目录

- [ ] **Step 3: Run focused RED verification**

Run: `npx vitest run packages/migration/src/cli.test.ts test/phase5/rehearsal-stage.integration.test.ts`

Expected: 新增verified-byte与custody assertions因入口缺失而失败

- [ ] **Step 4: Add the minimal verified-input migration entry**

复用现有`runMigration`、transaction、validation与manifest publish语义，只把key来源从file reopen改为caller-provided verified Buffer

- [ ] **Step 5: Add the private SQLite working-copy bridge**

Stage从source descriptor读取bytes，在自身`0700`temporary directory创建`0600`且exclusive的snapshot copy，调用migration后在`finally`清理，不使用`/dev/fd/N`

- [ ] **Step 6: Run focused GREEN verification**

Run: `npx vitest run packages/migration/src/cli.test.ts test/phase5/rehearsal-stage.integration.test.ts`

Expected: PASS

### Task 3: Artifact Rebuild And Verification

**Files:**
- Modify: `scripts/phase5-rehearsal-stage/artifact/stage.mjs`
- Modify: `scripts/phase5-rehearsal-stage/artifact.sha256`
- Modify: `scripts/phase5-rehearsal-stage/check-artifact.mjs` only if a direct v2 closure assertion requires it
- Modify: `package.json` only if the existing focused command cannot cover the v2 tests

- [ ] **Step 1: Add artifact-level descriptor and resource assertions**

使用synthetic descriptors验证committed artifact不依赖敏感path reopen，并验证migration/capacity result绑定resource ID

- [ ] **Step 2: Build the single artifact**

Run: `npm run phase5:stage:build`

Expected: `artifact/stage.mjs`与`artifact.sha256`更新，artifact目录仍只有一个runtime文件

- [ ] **Step 3: Verify artifact reproducibility and closure**

Run: `npm run phase5:stage:check`

Expected: fresh build逐byte一致、SHA-256匹配、runtime closure无repository loader或toolchain execution

- [ ] **Step 4: Run task verification and scope audit**

Run: `npx vitest run packages/migration/src/cli.test.ts test/phase5/rehearsal-stage.integration.test.ts`

Run: `node --test test/contracts/phase5-rehearsal-stage.test.js test/contracts/phase5-stage-closure-checker.test.js`

Run: `npm run lint && npm run typecheck`

Expected: 全部PASS，diff只包含Task Contract允许范围

## Escalation Conditions

- SQLite working copy无法在stage-owned custody中保持migration语义
- 需要修改migration transaction、Schema、8项validation或capacity contract
- 需要新dependency、新外部资源、真实input或Gate变化
- Artifact无法保持单文件、可复现或closed runtime
