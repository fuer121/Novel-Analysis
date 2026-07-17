# Phase 0 Foundation Handoff

## Status

- Status: DONE
- Date: 2026-07-17
- Branch: `refactor/phase-0-foundation`
- Phase base: `c573016`
- Verified code head before this handoff-only commit: `c9623b6`

All verification evidence below was freshly collected at `c9623b6` before the docs-only handoff commit

## Clean Install

- Node `26.1.0`
- npm `11.13.0`
- `npm ci` exited 0 after installing 271 packages and auditing 274 packages
- `package-lock.json` SHA-256 remained `fd3d5da157b57ea0d7a37e04d28d4a5c0c848697d34903b7866d36d420a0f3bd`
- Worktree remained clean after installation

## Verification

| Command | Fresh evidence at `c9623b6` |
| --- | --- |
| `npm run verify:legacy` | Exit 0, 112 tests passed, legacy lint passed, Vite build passed with 1,746 modules transformed |
| `npm run verify:new` | Exit 0, contracts and domain typechecks passed, 5 Node contract tests passed, 32 Vitest tests passed across 2 files |
| `npm run dify:manifest:check` | Exit 0, 1 manifest test passed |
| `npm test` | Exit 0, 112 legacy + 5 contract + 32 Vitest tests passed |
| `npm run lint` | Exit 0, full repository lint passed |
| `npm run verify` | Exit 0, combined legacy verification, new verification, and manifest check passed |
| `git diff --check` | Exit 0 with no output |

## No Behavior Drift

- `git diff c573016 -- src server public vite.config.js` produced no output
- `git diff c573016 -- dify-workflows/*.yml` produced no output for all five workflow exports
- Root legacy production behavior and tracked workflow YAML are unchanged from the phase base

## Dependency Selection

- TypeScript `6.0.3`
- typescript-eslint `8.64.0`
- Zod `4.4.3`
- `npm ls --workspaces --depth=0` and `npm ls typescript typescript-eslint zod --all` exited 0 with a valid workspace, peer, and deduplication graph

## Public Exports

`packages/contracts/src/index.ts` re-exports `./job-contract.js`

Runtime exports:

- `JOB_TYPES`
- `JOB_STATUSES`
- `JOB_EVENT_TYPES`
- `JobTypeSchema`
- `JobStatusSchema`
- `JobEventTypeSchema`
- `BookJobScopeSchema`
- `MigrationJobScopeSchema`
- `JobScopeSchema`
- `JobProgressSchema`
- `PublicJobSchema`
- `JobEventSchema`

Type exports:

- `JobType`
- `JobStatus`
- `JobEventType`
- `BookJobScope`
- `MigrationJobScope`
- `JobScope`
- `JobProgress`
- `PublicJob`
- `JobEvent`

`packages/domain/src/index.ts` re-exports `./jobs/job-state.js`

Domain exports:

- `InvalidJobTransitionError`
- `canTransitionJob`
- `assertJobTransition`

## Workflow Manifest

Running `npm run dify:manifest` twice left the manifest unchanged and the worktree clean after each run

- Manifest SHA-256: `7505879bf09348a0058e2e09723fc1637b92268beb01f6116695517207880cc4`
- `analysis_chapter`: `828378e17489a9bbdcfea061a264eb2e4e4d1c54d1ef3afcb2eea25b4e45fb22`
- `analysis_summary`: `dcdf0de57bba12f30be516fb7df1f97b33e7c233ca63002a493c591bdf0fdde7`
- `chapter_import`: `68bcb0ac2f2e469a25caa385c0c83bcba50a7c9c18f80554ee8070c24c76fb8d`
- `l1_index`: `ebd3d3b403e9dd10bc6f5f0a2a16e94c7cfe94dc5c83ed766b34ba9f00190bf9`
- `l2_index`: `6242ceac66358ab44211cb209e5d62b5f0bd94cb0201f7ebcca5990e035ad6d1`

## Phase Commits

```text
8acfcac test: record legacy contract baseline
e677d3d chore: add TypeScript workspace toolchain
d39f5d9 feat: define shared job contracts
fe018e7 fix: complete shared job contract
eade9be fix: reject ambiguous job scopes
1b72bef feat: add persistent job state rules
d97f0e1 test: freeze Dify normalization contracts
800d67f test: strengthen Dify normalization contracts
7289d46 chore: track Dify workflow hashes
ac09fc4 test: verify Dify manifest mapping
10f2f58 ci: verify legacy and new architecture contracts
d438044 fix: pin TypeScript ESLint
c9623b6 fix: validate CI repository diffs
```

## Deferred And Known Items

- `JobProgress` currently permits counters above `total`; define the invariant in Phase 1 domain semantics
- Current transition tests cover all 16 allowed pairs and 5 representative rejected pairs; strengthen coverage to all 33 rejected pairs and add explicit error `name`, `from`, `to`, and `message` assertions during Phase 1 test hardening
- `npm audit` reports 5 known findings: 1 low, 1 moderate, 1 high, and 2 critical; advisory remediation is separate maintenance and these findings are not fixed by Phase 0
- GitHub Actions use floating `v4` tags; full SHA pinning is separate supply-chain hardening

## Available Inputs

- Stable contracts and domain exports listed above
- Established job status transition semantics
- Deterministic workflow manifest and five workflow hashes listed above

## Phase 1 Scope To Plan

- PostgreSQL schema and migrations
- Feishu authentication and RBAC
- Jobs, steps, attempts, events, and outbox persistence
- pg-boss dispatcher and worker lease behavior
- SSE projection
- Minimal web shell and task center

This handoff commit changes documentation only and must not alter the code artifacts, configuration, manifests, or workflow YAML verified at `c9623b6`
