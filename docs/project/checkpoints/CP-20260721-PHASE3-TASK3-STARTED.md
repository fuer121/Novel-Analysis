---
checkpoint_id: CP-20260721-PHASE3-TASK3-STARTED
task_id: PHASE3-TASK3
status: accepted
recorded_at: 2026-07-21T10:57:27+08:00
branch: codex/phase3-task3-started
base_commit: 08ff7c6e101cea4b1ce205f889b3703a5e665ee8
head_commit: 08ff7c6e101cea4b1ce205f889b3703a5e665ee8
supersedes: none
---

# Phase 3 Task 3 Started

## Scope

### Core Allowed Modules

- `packages/domain/src/query/intent.ts`
- `packages/domain/src/query/intent.test.ts`
- `packages/domain/src/query/recall-policy.ts`
- `packages/domain/src/query/recall-policy.test.ts`
- `packages/domain/src/index.ts`
- `test/phase3/fixtures/legacy-query-golden.ts`

### Mechanical Adjacent Scope

- directly corresponding tests, types, package exports and test configuration only when directly required
- no package manifest, lockfile or dependency changes

### Success Criteria

- `resolveQueryIntent` accepts only the current `question`, `recentQuestions` and `knownSubjects`
- intent resolution uses `recentQuestions.slice(-3)` and resolves pronouns only from recent user questions
- intent exposes exactly `single-target`, `collection` and `general` kinds
- broad collection questions such as `有哪些重要法宝` do not invent a target
- `recallFacts` considers every requested chapter window, including late chapters, before applying candidate and used limits
- target facts rank before related facts, with stable tie-breaking by `chapterIndex` and then `factId`
- every excluded candidate has an explicit exclusion reason
- single-target, collection, general and late-chapter golden cases pass
- previous model answers are excluded by both the TypeScript signature and runtime behavior
- legacy 112/112 remains green

### Prohibited Changes

- database, schema, migration, API, jobs, Worker or Web changes
- Dify YAML, manifest, credentials or real keys
- new dependencies, package manifest or lockfile changes
- embeddings, vector database or a new recall service
- changes to existing Query public contracts
- Phase 3 Tasks 4-7 behavior or Phase 4 behavior
- Gate, acceptance criteria, formal data, deployment or cutover changes

### Required Verification

- observable RED before production implementation
- `npm test -w packages/domain -- query`
- `npm test -w packages/domain`
- `npm run test:legacy`
- `npm run typecheck:new`
- `npm run lint`
- `git diff --check`
- independent specification review followed by independent code-quality review
- controller `npm run verify:controller`, Phase 1 and Phase 2 E2E, Phase 2 typecheck and Web build before merge
- post-merge focused smoke and `npm run verify:post-merge`

### Escalation Conditions

- golden cases require old answer text as intent, recall, evidence or runtime input
- full-window recall cannot satisfy candidate limits without changing the approved architecture
- a new dependency, embeddings or vector database becomes necessary
- existing Query contracts must change
- database, API, jobs, Worker, Web or Dify files become necessary
- Gate, task order, formal data, deployment, cutover or another irreversible action changes
- baseline becomes stale, conflicted or blocked

## Evidence

- PHASE3-TASK2 was merged by PR #83 and accepted by `CP-20260721-PHASE3-TASK2-MERGED`
- main and origin/main are aligned at `08ff7c6e101cea4b1ce205f889b3703a5e665ee8` with a clean primary workspace
- the approved Phase 3 design and plan define deterministic intent parsing and full-window recall as Task 3
- the user explicitly requested direct creation and progression on 2026-07-21
- current `baseline_status` is `current` with no evidence conflict or blocker

## Accepted Result

PHASE3-TASK3 may proceed from the final merge SHA of this Started Contract using TDD, one implementation worktree and independent specification and code-quality review

This checkpoint does not accept Task 3, unlock Task 4, change the Phase Gate, operate on formal data or authorize deployment
