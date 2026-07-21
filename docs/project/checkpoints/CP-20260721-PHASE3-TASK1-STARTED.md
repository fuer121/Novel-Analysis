---
checkpoint_id: CP-20260721-PHASE3-TASK1-STARTED
task_id: PHASE3-TASK1
status: accepted
recorded_at: 2026-07-21T08:49:56+08:00
branch: codex/phase3-task1-started
base_commit: 9e044ab5f4bc25212b159587440a1cd2fe2a664a
head_commit: 9e044ab5f4bc25212b159587440a1cd2fe2a664a
supersedes: none
---

# Phase 3 Task 1 Started

## Scope

### Core Allowed Modules

- `packages/contracts/src/query-contract.ts`
- `packages/contracts/src/query-contract.test.ts`
- `packages/contracts/src/dify-contract.ts`
- `packages/contracts/src/index.ts`
- `packages/dify/src/adapter.ts`
- `packages/dify/src/http-adapter.ts`
- `packages/dify/src/fake-adapter.ts`
- `packages/dify/src/normalizers.ts`
- `packages/dify/src/http-adapter.test.ts`

### Mechanical Adjacent Scope

- directly corresponding tests, types and package exports
- existing test fakes required by the approved adapter behavior
- no lockfile or dependency changes

### Success Criteria

- strict Query Zod contracts reject facts, answer text and unknown intent keys
- turn status distinguishes `awaiting_fallback` and `degraded`
- session contract exposes visibility, default chapter range and `canManage`
- evidence contract exposes fact reference, chapter, body, rank, recall reason, disposition and exclusion reason
- `DifyTarget` includes the tracked `analysis-summary` workflow and the adapter exposes `runAnalysisSummary`
- HTTP input maps the tracked DSL fields exactly, with existing unused optional fields represented by empty values or the string `"false"`
- only a non-empty `outputs.result` is accepted and normalized as `{ text }`
- timeout, network, 429 and 5xx failures receive at most three adapter-level attempts while invalid responses are not retried
- the existing three Dify targets retain their behavior and no YAML changes occur

### Prohibited Changes

- Dify YAML, manifest or credential files and real-key usage
- schema, migration, database, jobs, API, Worker or Web changes
- dependency or lockfile changes
- Phase 3 Tasks 2-7, Phase 4, formal data operations, deployment or cutover
- new workflow, new external dependency or changed Gate and acceptance criteria

### Required Verification

- observed Query contract RED before contract implementation
- observed analysis-summary adapter RED before adapter implementation
- `npm test -w packages/contracts`
- `npm test -w packages/dify`
- `npm run typecheck:new`
- `npm run lint`
- `git diff --check`
- independent specification and code-quality reviews
- controller `npm run verify:controller` before merge
- post-merge focused smoke and `npm run verify:post-merge`
- scope audit against this checkpoint base proving no prohibited changes

### Escalation Conditions

- the tracked `analysis-summary` DSL cannot satisfy the approved contract without a YAML change
- retry behavior requires changing shared timeout policy or weakening an existing assertion
- implementation requires a new data object, dependency, authentication, permission or API product capability
- credentials, plaintext sensitive content or answers would enter logs or unintended adapter fields
- Gate, acceptance criteria, task order, formal data, deployment, cutover or another irreversible action would change
- baseline becomes stale, conflicted or blocked

## Evidence

- Phase 3 Plan Gate merged as PR #78 at `9e044ab5f4bc25212b159587440a1cd2fe2a664a`
- `CP-20260721-PHASE3-PLAN-APPROVED` explicitly unlocks Task 1 from the Gate merge SHA
- main and origin/main are aligned and the main worktree is clean
- `npm run project:check` passes
- `npm run test:project-source` passes 42/42
- the repository tracks `analysis-summary.workflow.yml`; the approved plan forbids modifying it

## Accepted Result

PHASE3-TASK1 may proceed from `9e044ab5f4bc25212b159587440a1cd2fe2a664a` using TDD, one implementation worktree and independent specification and code-quality review

This checkpoint does not accept Task 1, unlock Task 2, change a Gate, modify the DSL, add data objects or authorize deployment
