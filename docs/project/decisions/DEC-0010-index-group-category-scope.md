---
decision_id: DEC-0010
status: accepted
recorded_at: 2026-07-20T19:50:51+08:00
confidence: high
scope: phase2-task5-task6-index-group-category-scope
supersedes: none
---

# Index Group Category Scope

## Context

Task 6 specification review found that magical-creature admission was selected through the mutable-looking index-group key `magical-creatures`, while the accepted legacy behavior selects it through explicit `category_scope`

Keys are identifiers chosen by users and cannot safely carry admission semantics: renaming a specialized group disables admission, while reusing the key for an unrelated group enables it accidentally

The same review found that candidate facts were retained but could not become eligible after a later chapter verified their subject

## Decision

- Add immutable `category_scope` to `index_groups` with the supported values `general` and `magical_creature`
- Index-group creation must provide the scope, include it in `config_hash`, return it in the group projection and freeze it in each L2 job snapshot
- Existing rows migrate to `general`; no existing production data is modified by this repository migration
- Admission selects specialized behavior only from the frozen `category_scope`, never from group key or model-returned category
- When a chapter explicitly verifies a subject, candidate facts for the same group and subject become scope eligible in the same completion transaction
- Scope cannot be edited after group creation; Task 5 create-only semantics remain unchanged

## Consequences

- Task 5 API, snapshot and migration scope expand only as required to represent the approved immutable semantic type
- Task 6 database and executor scope expands only as required for atomic candidate promotion
- No new table, external dependency, category allowlist value, authentication behavior, Gate or user-visible workflow is introduced
- Existing callers must explicitly choose `general` or `magical_creature` when creating a new index group

## Source

用户于 2026-07-20 在理解三个方案的实际使用差异后明确选择方案 A
