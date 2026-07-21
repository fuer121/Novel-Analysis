---
checkpoint_id: CP-20260721-PHASE4-TASK1-STARTED
task_id: PHASE4-TASK1
status: accepted
recorded_at: 2026-07-21T22:25:44+08:00
branch: codex/phase4-task1-contracts
base_commit: ca6d5d240110e6c54beebd7d50c9012190e6ec3d
head_commit: ca6d5d240110e6c54beebd7d50c9012190e6ec3d
supersedes: none
---

# Phase 4 Task 1 Started

## Scope

### Core Allowed Modules

- `packages/contracts/src/advanced-analysis-contract.ts`
- `packages/contracts/src/advanced-analysis-contract.test.ts`
- `packages/contracts/src/index.ts`
- `packages/domain/src/analysis/mode-policy.ts`
- `packages/domain/src/analysis/mode-policy.test.ts`
- `packages/domain/src/index.ts`
- `test/phase4/fixtures/legacy-analysis-golden.ts`

### Mechanical Adjacent Scope

- directly corresponding tests, types and package exports
- no runtime wiring, migration registry, dependency or lockfile changes

### Success Criteria

- strict public schemas cover private template create/update, mode, chapter range, preview hash, owner run summaries/details and part progress
- administrator metadata schemas contain no Prompt, Schema, result, part content or reversible content fingerprint
- legacy detail is fixed to `readOnly: true` and `canResume: false`
- `fast_index` reads L1/L2 and reviews zero original chapters
- `balanced` review budget is `min(10,max(3,ceil(chapterCount*0.01)))`
- `precision` review budget is `min(30,max(5,ceil(chapterCount*0.03)))`
- `full_text` reads every selected original chapter
- legacy fixtures contain only read-only public behavior and no SQLite runtime dependency

### Prohibited Changes

- database, schema, migration, jobs, API, Worker or Web changes
- legacy SQLite runtime imports or old `server/workflows.js` reuse
- mode names, source boundaries or default budget changes
- Dify YAML, manifest, credential files or real-key use
- dependency or lockfile changes
- Phase 4 Tasks 2-7, formal data, deployment, UAT, cutover or Phase 5 behavior
- new authentication, authorization, sharing or deletion semantics

### Required Verification

- observed contracts RED before implementation
- observed mode-policy RED before implementation
- `npm test -w packages/contracts`
- `npm test -w packages/domain`
- `npm run typecheck:new`
- `npm run lint`
- `git diff --check`
- scope audit against the Task 1 implementation base
- independent specification and code-quality reviews
- controller `npm run verify:controller` before merge
- post-merge focused smoke and `npm run verify:post-merge`

### Escalation Conditions

- public schemas require changing an accepted data, privacy, administrator or deletion policy
- compatible mode behavior cannot be represented without changing legacy source boundaries or budgets
- implementation needs database, API, Worker, Web, new dependency or lockfile changes
- fixtures require SQLite, legacy runtime imports, credentials or formal data
- Gate, acceptance criteria, task order, deployment, cutover or another irreversible action would change
- baseline becomes stale, conflicted or blocked

## Evidence

- `CP-20260721-PHASE4-PLAN-APPROVED` accepts the seven-task implementation plan and unlocks Task 1 after merge
- main and origin/main are aligned at `ca6d5d240110e6c54beebd7d50c9012190e6ec3d` and the main worktree is clean
- the accepted design and plan explicitly preserve the four legacy mode boundaries while excluding old runtime dependencies
- `npm run project:check` and `npm run test:project-source` passed before this contract

## Accepted Result

PHASE4-TASK1 may proceed from the final Gate governance merge SHA using TDD, one implementation worktree and independent specification and code-quality review

This checkpoint does not accept Task 1, unlock Task 2, change schema or authorize production behavior
