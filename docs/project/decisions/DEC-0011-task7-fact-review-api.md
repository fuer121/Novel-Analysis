---
decision_id: DEC-0011
status: accepted
recorded_at: 2026-07-20T20:34:18+08:00
confidence: high
scope: phase2-task7-fact-review-api
supersedes: none
---

# Task 7 Fact Review API

## Context

Task 7 requires paginated fact review, and the accepted database repository and contracts already provide `listFactReviews` and `FactReviewPage`

Implementation inspection found no API route exposing that read model, so a real Web fact review cannot be completed without a minimal API expansion

## Decision

- add `GET /api/books/:bookId/index-groups/:groupId/facts?limit=&cursor=` to the existing index-group router
- reuse the existing session authentication, `listFactReviews` repository method and `FactReviewPage` contract
- validate book/group ownership through the existing repository query boundary and return not found for an unavailable group
- keep pagination cursor and limit behavior identical to the accepted repository contract

## Consequences

- Task 7 API scope expands only for this read-only projection and its direct integration tests
- no table, migration, write behavior, fact mutation, permission rule, plaintext storage or Phase 3 capability is added
- fact bodies remain authorized response data and must only live in the Web query cache

## Source

用户于 2026-07-20 在总控报告缺失只读 API 后明确授权推荐的最小接口方案
