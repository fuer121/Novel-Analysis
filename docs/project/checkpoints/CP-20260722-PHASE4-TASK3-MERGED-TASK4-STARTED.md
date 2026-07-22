---
checkpoint_id: CP-20260722-PHASE4-TASK3-MERGED-TASK4-STARTED
task_id: PHASE4-TASK4
status: accepted
recorded_at: 2026-07-22T10:13:31+08:00
branch: codex/phase4-task4-analysis-worker
base_commit: 6e882a10496b6931ba70af0618176edd6121aa5d
head_commit: 6e882a10496b6931ba70af0618176edd6121aa5d
supersedes: none
---

# Phase 4 Task 3 Merged And Task 4 Started

## Scope

记录 PHASE4-TASK3 与 DEC-0016 加密执行快照实现合并，并接受 PHASE4-TASK4 的可恢复四模式 Worker executor Task Contract

### Core Allowed Modules

- `apps/worker/src/analysis-source-selector.ts`
- `apps/worker/src/analysis-source-selector.test.ts`
- `apps/worker/src/analysis-executor.ts`
- `apps/worker/src/analysis-executor.integration.test.ts`
- `apps/worker/src/worker.ts`
- `apps/worker/src/main.ts`
- `apps/worker/src/worker.integration.test.ts`
- `test/phase4/fixtures/analysis-mode-golden.ts`

### Mechanical Adjacent Scope

- directly corresponding contracts、tests、types、exports and existing Worker runtime wiring
- existing analysis repository may receive only transaction-aware snapshot/part/run completion methods directly required by current attempt and lease authority
- existing jobs step lease、control completion、outbox and Dify adapter interfaces may be reused and mechanically wired but not behaviorally redefined
- existing Worker test harness/runtime configuration may be updated to inject the accepted `AdvancedAnalysisExecutionConfig`
- no API product behavior、Web、legacy route or new migration

### Success Criteria

- Worker decrypts and strict-validates the Task 3 execution snapshot and never queries current chapter、L1、L2、template、workflow or execution config as a substitute for frozen input
- source selector preserves compatible boundaries：`fast_index` uses only frozen L1/L2，`balanced` and `precision` review only deterministic frozen chapter subsets，`full_text` reads every selected frozen chapter
- source selector uses the accepted mode policy and golden budgets without introducing ranking or algorithm changes
- execution separates source selection、part execution、hierarchical summary and final validation into testable units
- every provider input derives only from the frozen snapshot and authorized chapter decryption for snapshot-selected chapters，never from mutable current index selection
- Prompt、Schema、chapter、L1 route、L2 fact payload、part result and final result remain encrypted outside provider memory and authorized owner responses
- part completion commits ciphertext and completed status atomically only for the current attempt with an unexpired lease，failed、running or signature-mismatched parts are not reusable
- completed parts with exact run/kind/position/input signature are reused after Worker crash、lease expiry、outbox replay or repeated wake，provider is not called again for reused parts
- pause takes effect only at a safe step boundary，cancel prevents further provider calls and persistence，late or superseded attempts cannot commit part or final results
- partial failure keeps completed parts reusable and stores only stable sanitized error codes outside encrypted diagnostics
- final hierarchical summary and result must pass the frozen output Schema before run/Job completion，invalid or empty provider output cannot mark completion
- Job、run、step、attempt、event and outbox transitions remain coordinated through existing lease/state-machine authority，one terminal result and one terminal completion win under repeated wake or concurrent attempts
- provider retry uses the accepted Dify adapter retry behavior and does not add a second retry loop
- Worker production runtime requires the same explicit model、reasoning effort and executor version contract frozen by Task 3，configuration mismatch fails closed before execution

### Prohibited Changes

- current-state fallback for missing/invalid execution snapshot
- new table、migration、L2 retention/version behavior、formal data migration or snapshot format weakening
- new Job state、lease semantic、outbox delivery semantic or independent retry loop
- API product route、administrator content access、hard-delete semantic、Web or legacy behavior
- new external dependency、Dify DSL/YAML/manifest/credential content or lockfile
- plaintext sensitive content in Job、step output reference、event、outbox、audit、log、error or administrator metadata
- deployment、UAT、cutover、Phase 5、Phase 4 Gate、acceptance criteria or task order change

### Required Verification

- RED golden tests for all four frozen source boundaries before selector implementation
- RED PostgreSQL integration for encrypted part commit、snapshot-only execution、Schema validation、partial failure、pause、cancel、repeated wake、lease expiry、reuse、signature mismatch、outbox replay and late attempt rejection
- real snapshot regression replaces current L1/L2 after run creation and proves Worker still uses only original frozen route/facts
- provider call-count evidence proves exact completed part reuse and no duplicate final summary under recovery or concurrent wake
- transaction rollback and attempt/lease race reproductions prove no ciphertext or completed state survives stale/failed commit
- plaintext sentinel scan covers database rows、Job/step/event/outbox/audit JSON、captured Worker logs、controlled provider errors and invalid Schema output
- `npm run test -w apps/worker -- analysis-source-selector.test.ts`
- `npm run test -w apps/worker`
- `npm run test:integration -- analysis-executor.integration.test.ts worker.integration.test.ts`
- `npm run typecheck:phase3`
- `npm run lint`
- `git diff --check`
- scope audit against the final governance merge SHA
- independent specification and code-quality reviews
- controller `npm run verify:controller` before merge
- post-merge focused Worker/database smoke and `npm run verify:post-merge`

### Escalation Conditions

- snapshot lacks information required for any accepted mode or requires current-state fallback、migration or snapshot format change
- correct part/final commit cannot reuse existing attempt/lease authority without Job state-machine or database architecture changes
- pause、cancel、outbox replay or late-attempt correctness requires a new state、queue or retry semantic
- sensitive content would enter ordinary persistence、log、error or administrator surfaces
- Dify adapter requires DSL、credential policy、dependency or provider contract changes
- API、Web、formal data、deployment、Gate or acceptance change is required
- baseline becomes stale、conflicted or blocked

## Evidence

- PHASE4-TASK3 accepted checkpoint merged after DEC-0016、independent specification and quality reviews、controller verification and PR #114 CI passed
- PR #114 merged at `6e882a10496b6931ba70af0618176edd6121aa5d`
- post-merge project source 42、project check、workspace audit and controller health passed
- serial post-merge Worker-adjacent/API/database smoke passed 59，the earlier parallel-only timeout did not reproduce in isolated 19-test or full 59-test runs
- main and origin/main align at `6e882a10496b6931ba70af0618176edd6121aa5d` and the main worktree is clean
- accepted Phase 4 plan and DEC-0016 explicitly require four compatible modes、snapshot-only recovery、lease authority and late-attempt rejection

## Accepted Result

PHASE4-TASK3 is merged and PHASE4-TASK4 may proceed from the final governance merge SHA using TDD、one implementation worktree and independent reviews

This checkpoint does not accept Task 4、unlock Task 5、authorize formal data operations、deployment or cutover
