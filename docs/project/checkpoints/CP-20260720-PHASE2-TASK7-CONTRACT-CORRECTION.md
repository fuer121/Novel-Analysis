---
checkpoint_id: CP-20260720-PHASE2-TASK7-CONTRACT-CORRECTION
task_id: PHASE2-TASK7
status: accepted
recorded_at: 2026-07-20T20:34:18+08:00
branch: codex/phase2-task7-book-workspace
base_commit: 4c117ba6243fddbfa1098470a37463e08f6788b9
head_commit: 4c117ba6243fddbfa1098470a37463e08f6788b9
supersedes: CP-20260720-PHASE2-TASK7-STARTED
---

# Phase 2 Task 7 Contract Correction

## Scope

In addition to the original Task 7 Web scope, allow these directly causal changes

- `apps/api/src/routes/index-groups.ts`
- its direct integration test
- existing database/content-cipher wiring required to call `listFactReviews`

## Required Behavior

- expose authenticated paginated facts for one book/index group
- reject invalid limits and cursors using the existing repository contract
- prevent cross-book group access
- do not add fact writes, review mutations or new authorization semantics
- Web fact bodies remain in query cache only

## Required Verification

- API integration tests for authentication, book/group isolation, pagination and invalid cursor/limit
- original Task 7 Web, browser and controller verification

## Prohibited Changes

- database schema, migration, repository pagination semantics or encryption strategy
- fact mutation, deletion, approval state or Phase 3 query capability
- authentication, authorization, CSRF or credential changes

## Evidence

- `packages/database/src/library/index-repository.ts` already implements encrypted fact pagination
- `packages/contracts/src/library-contract.ts` already defines the response contract
- the accepted index-group router lacks a facts route
- user explicitly authorized the minimal read-only API expansion

## Accepted Result

Task 7 may continue under DEC-0011 and this corrected contract
