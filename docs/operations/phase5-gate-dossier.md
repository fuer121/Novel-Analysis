# Phase 5 Engineering Gate Dossier

This dossier indexes local engineering evidence only and does not approve or execute an operation Gate

## Accepted Engineering Tool Evidence

| Evidence | Accepted record | Existing verification surface |
| --- | --- | --- |
| Selective migration and rollback tooling | `CP-20260723-PHASE5-TASK1-ACCEPTED` through `CP-20260723-PHASE5-TASK5-ACCEPTED` | `npm run test:phase5` |
| Local isolated capacity correctness and indicative timing | `CP-20260723-PHASE5-TASK6-ACCEPTED` | `npm run test:phase5:scale` outside standard CI |
| Environment-neutral deployment reference and fail-closed preflight | `CP-20260723-PHASE5-TASK7-ACCEPTED` | `npm run phase5:preflight -- --config deploy/phase5/env.example --dry-run` |
| Evidence metadata contract | Pending PHASE5-TASK8 review | `npm run test:contracts -- phase5-acceptance.test.js` |

`npm run phase5:acceptance -- --manifest <local-json> --expected-sha <commit>` validates recorded command, exit code, commit SHA, local artifact path and SHA-256 fingerprint without rerunning or duplicating the underlying engineering assertions

## Pending Formal Gates

| Order | Gate | Status | Required external decision or evidence |
| --- | --- | --- | --- |
| 1 | Production snapshot access | Pending, locked | Explicit access authorization and approved snapshot evidence |
| 2 | Target-server isolated rehearsal | Pending, locked | Authorized target server and isolated hard-threshold rehearsal |
| 3 | Feishu and UAT | Pending, locked | Approved callback configuration, participants and signed UAT evidence |
| 4 | Deployment | Pending, locked | Explicit deployment approval and target-specific operational checks |
| 5 | Formal cutover | Pending, locked | Explicit cutover decision after all preceding Gates pass |

Engineering evidence cannot change any pending Gate status, and manifest validation never constitutes Gate acceptance
