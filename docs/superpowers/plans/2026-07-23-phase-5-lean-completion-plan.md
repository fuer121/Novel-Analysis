# Phase 5 Lean Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Phase 5 engineering tools with the minimum evidence needed for safe migration preparation, while moving environment-dependent capacity and operations checks to their actual Gates

**Architecture:** Tasks 1–5 and their accepted behavior remain unchanged. This correction replaces only Tasks 6–8 of the original Phase 5 plan: Task 6 proves concurrency correctness and produces indicative timing, Task 7 provides environment-neutral deployment and operations inputs, and Task 8 aggregates existing evidence without reimplementing business assertions

**Tech Stack:** TypeScript, Node.js, Vitest, PostgreSQL, Docker Compose reference templates, Markdown

---

## Approved Boundary

- This plan supersedes Tasks 6–8 and their ordering in `2026-07-23-phase-5-migration-cutover-implementation-plan.md`
- Tasks 1–5 remain accepted and unchanged
- Local development-machine latency remains recorded but is not a Phase 5 tools merge threshold
- Browse `<500ms`、submit `<1000ms`与status propagation `<2000ms` become target-server isolated rehearsal criteria
- Production snapshot access、real Dify、Feishu callback changes、UAT、deployment与cutover remain prohibited
- Formal Gate order remains snapshot access → target-server rehearsal → UAT → deployment → cutover

## File Map

| Task | Files | Responsibility |
| --- | --- | --- |
| Task 6 | existing `test/phase5` scale harness、`scripts/run-phase5-scale.mjs`、report schema | concurrency correctness、priority、isolation与indicative timing |
| Task 7 | `deploy/phase5`、`scripts/phase5-preflight.mjs`、focused tests、operations checklists | environment-neutral topology与fail-closed configuration checks |
| Task 8 | `scripts/phase5-acceptance.mjs`、gate dossier、package script | orchestrate existing evidence without new business E2E |

## Task 6: Accept Capacity Harness As Correctness Evidence

**Core allowed modules:** existing Phase 5 load harness、controlled provider、isolation runner与report schema

**Mechanical adjacent scope:** direct contract tests、root scale command、project checkpoint

**Prohibited changes:** production code、migration、index、cache、queue policy、threshold lowering、real Dify、formal data、deployment或cutover

**Required behavior:**

- 3 books、3000 chapters、70000 facts synthetic profile remains unchanged
- 20 authenticated browse operations and 10 concurrent submissions complete without correctness failure
- interactive submission remains ahead of queued background work without interrupting a running Step
- repository-wide single-instance lock fails closed before database creation、measurement或report writing
- report preserves raw samples、server profile、p95 values、contract version与isolation metadata
- local threshold failure is reported honestly but does not fail Phase 5 tools acceptance

- [ ] **Step 1: Re-review the existing Task 6 implementation against the corrected contract**

Run: `node --check scripts/run-phase5-scale.mjs && node --test test/contracts/phase5-scale-lock.test.js`

Expected: syntax PASS and lock contract 4/4 PASS

- [ ] **Step 2: Verify correctness and scope without another timing-tuning loop**

Run: `npm run test:phase5 && npm run test:integration && npm run typecheck:phase5 && npm run lint && git diff --check`

Expected: functional suites PASS and no production、migration、index、cache或queue-policy change

- [ ] **Step 3: Preserve the latest timing reports as indicative evidence**

Record the existing PASS/FAIL reports and explain that target-server rehearsal owns the hard latency decision

Expected: no report deletion、threshold rewriting或claim of production capacity

- [ ] **Step 4: Complete independent specification and quality review**

Specification review checks corrected contract coverage. Quality review checks lock lifecycle、concurrency correctness、priority、cleanup and truthful reporting, but does not require development-machine p95 PASS

Expected: `SPEC_COMPLIANT` and `QUALITY_APPROVED`

- [ ] **Step 5: Commit Task 6 acceptance governance**

```bash
git add docs/project docs/superpowers/plans
git commit -m "docs: accept lean Phase 5 capacity evidence"
```

## Task 7: Minimal Single-Server Reference And Checklists

**Core allowed modules:** deployment reference、read-only preflight、operations documentation

**Mechanical adjacent scope:** focused script tests、environment example、package command

**Prohibited changes:** real domain、certificate、credentials、external callback、service mutation、production data、deployment或traffic switch

**Required behavior:**

- Compose reference exposes only HTTPS entry and keeps API、Worker与PostgreSQL internal
- secret values are file or environment references and no credential is committed
- preflight validates HTTPS origin、exact callback path、database non-exposure、health checks、key length、distinct encryption/HMAC keys and explicit operation Gate
- snapshot、UAT、cutover and repair documents remain checklists with required evidence fields
- certificate expiry、clock skew、disk capacity、backup capacity and target-specific commands remain deferred until a target server exists

- [ ] **Step 1: Write focused fail-closed tests**

Test only the seven environment-neutral conditions listed above

Run: `npm run test:phase5 -- preflight.test.ts`

Expected: RED before the minimal preflight exists

- [ ] **Step 2: Implement the smallest reference topology and read-only preflight**

Do not add target-specific probes or automatic remediation

Run: `npm run test:phase5 -- preflight.test.ts`

Expected: focused tests PASS

- [ ] **Step 3: Add concise operation checklists**

Each checklist names owner、approver、input、evidence、hard stop and Gate dependency without embedding unverified server commands

- [ ] **Step 4: Verify no secret or external action**

Run: `npm run phase5:preflight -- --config deploy/phase5/env.example --dry-run && npm run test:phase5 -- preflight.test.ts`

Expected: dry-run performs no mutation and tests PASS

## Task 8: Thin Evidence Aggregator

**Core allowed modules:** local evidence orchestrator、gate dossier、package command

**Mechanical adjacent scope:** project checkpoint and existing CI command references

**Prohibited changes:** new business E2E assertions、duplicate migration/readiness/recovery logic、formal operations、automatic Gate acceptance

**Required behavior:**

- invoke existing focused and integration commands rather than reimplement their assertions
- record command、exit code、commit SHA、artifact path and artifact fingerprint
- fail on missing、stale或contradictory evidence
- produce a dossier that separates engineering tools evidence from five still-pending formal Gates
- do not add production-scale timing to standard CI

- [ ] **Step 1: Write aggregator contract tests**

Use synthetic command-result fixtures to reject missing command、non-zero exit、wrong commit、missing artifact或fingerprint mismatch

- [ ] **Step 2: Implement the thin orchestrator**

The orchestrator owns metadata aggregation only and calls existing repository scripts

- [ ] **Step 3: Generate the Gate dossier**

Link accepted checkpoints、CI、existing test commands and unresolved risks without claiming production execution

- [ ] **Step 4: Run controller verification once**

Run: `npm run verify:legacy && npm run verify:new && npm run test:integration && npm run test:phase5 && npm run test:project-source && npm run project:check && git diff --check`

Expected: all commands PASS and the dossier reports formal Gates as pending

## Ordering

- Task 6 correction review and Task 7 implementation may proceed independently after this plan is merged
- Task 8 starts only after Tasks 6 and 7 are accepted
- Formal Gate ordering remains unchanged and none is authorized by this plan

## Governance And Verification

- Task 6 uses one correction acceptance checkpoint, not another repeatability-audit series
- Task 7 uses Started、Accepted and Merged nodes only unless architecture、security、data or Gate scope changes
- Task 8 may combine its Merged checkpoint with the Phase 5 tools Gate submission
- Implementers run focused verification; controller and CI each run the complete bounded suite once
- Development-machine timing reruns are not repeated unless the harness behavior changes
