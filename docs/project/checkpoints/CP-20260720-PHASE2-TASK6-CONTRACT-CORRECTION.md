---
checkpoint_id: CP-20260720-PHASE2-TASK6-CONTRACT-CORRECTION
task_id: PHASE2-TASK6
status: accepted
recorded_at: 2026-07-20T19:50:51+08:00
branch: codex/phase2-task6-l2-executor
base_commit: af33a6ff71f60c847006f73f206a419e7a4df1ce
head_commit: cadfa1cc76e156e36e4b70db41acd84b9aa4a9a3
supersedes: CP-20260720-PHASE2-TASK6-STARTED
---

# Phase 2 Task 6 Contract Correction

## Reason

Specification review proved that the original contract cannot satisfy golden admission parity without an explicit index-group semantic type and historical candidate promotion

## Scope

In addition to the original Task 6 scope, allow the minimum directly causal changes below

- reversible migration adding immutable `index_groups.category_scope`
- database type and migration registry wiring
- existing index-group create/list API, config hash and tests
- existing L2 job selection, scope hash, frozen snapshot and tests
- candidate promotion within the existing L2 completion transaction

## Required Behavior

- supported scope values are exactly `general` and `magical_creature`
- existing rows migrate to `general`
- magical-creature admission depends only on frozen `category_scope`
- group key and model-returned fact category cannot enable specialized admission
- candidate facts become eligible when the same subject is explicitly verified in a later committed chapter result
- failed, stale, cancelled or replayed completion cannot promote candidates

## Required Verification

- migration up/down and schema roundtrip
- index-group API create/list, config hash and immutable surface
- L2 job preview/snapshot hashing
- domain admission golden tests including arbitrary group keys
- PostgreSQL candidate promotion, rollback and replay tests
- original Task 6 verification plus controller verification before merge

## Prohibited Changes

- new table, new external dependency or new fact category
- index-group edit endpoint or mutable scope
- model-category-driven admission
- Task 7/8, authentication, permission, credential, Gate, formal data, deployment or cutover changes

## Evidence

- specification review identified key-based semantic selection in `packages/domain/src/library/l2-admission.ts`
- PostgreSQL repository review identified no update path from retained candidate facts to scope-eligible facts
- legacy golden behavior selects magical-creature admission through `category_scope` and promotes historical candidates after subject verification
- user explicitly selected immutable category scope option A

## Accepted Result

Task 6 may fix forward from implementation commit `cadfa1cc76e156e36e4b70db41acd84b9aa4a9a3` under DEC-0010 and this corrected contract

Task 7 remains locked
