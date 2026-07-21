---
decision_id: DEC-0015
status: accepted
recorded_at: 2026-07-21T16:58:24+08:00
confidence: high
scope: phase3-query-read-api
supersedes: none
---

# Query Turn History And Trace Projection

## Context

PHASE3-TASK6 implementation preflight confirmed that the accepted Query HTTP API can list sessions and read one turn only when its ID is already known

After navigation or reload, the Web client cannot rediscover historical turn IDs, reconstruct the conversation or recover server-owned in-flight state, and the accepted public turn shape does not expose the structured execution Trace required by the Phase 3 workspace design

## Decision

- add an authorized, bounded and cursor-paginated turn-history read endpoint under the existing book and Query session resource
- return conversation fields from the accepted `QueryTurn` contract without evidence bodies in the history page
- continue using the existing authorized single-turn endpoint for selected-turn evidence detail
- add one safe structured Trace projection derived only from already persisted intent、source、gap and configuration metadata
- Trace may expose query kind、target、aliases、referents、categories、keywords、source counts、gap count and the stored recall/summary workflow version labels
- Trace must not expose execution signature、question HMAC、evidence snapshot hash、job/attempt internals、raw provider errors、credentials or unrestricted snapshots
- use the existing session visibility and turn authorization boundary for both history and detail reads
- do not add a table、column、migration、new permission role、browser persistence or Worker behavior

## Consequences

- Task 6 can restore conversation and in-flight statuses from server state after navigation or reload
- the Web can render adopted evidence、candidate recall and a bounded execution Trace without inventing client-side state
- the public Query contract and API tests expand before Task 6 implementation resumes
- any future Trace field outside this allowlist requires a separate contract and security review

## Source

用户于 2026-07-21 在 Task 6 blocker 决策中明确选择方案 A：先增加最小 turns 分页读取与安全 Trace 投影，再恢复响应式工作区实施
