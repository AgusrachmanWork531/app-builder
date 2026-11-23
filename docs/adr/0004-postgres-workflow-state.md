# ADR 0004: PostgreSQL as the source of truth for workflow state

- Status: Accepted
- Date: 2026-11-23

## Context

Build status is shown to users, drives authorization decisions (cancel/retry/archive),
must survive queue loss and must stay consistent under concurrent writers (API cancel vs
worker progress vs reconciler vs dispatcher).

## Decision

Persist the authoritative status in `build_jobs` and an append-only `build_job_events`
log. All transitions go through `workflow-store`: lock the row (`FOR UPDATE`), validate
with the explicit state machine, bump `version`, append an event with a monotonic
sequence — in one transaction. Plans, tasks, checkpoints and artifacts are unique per
attempt. SSE tails the event log by sequence.

## Consequences

- Concurrent writers serialize instead of racing; invalid transitions are rejected.
- Exactly-once side effects are not assumed: deduplication keys and get-or-create make
  redelivery safe.
- SSE works across API instances without pub/sub (at the cost of polling; a shared poller
  or `LISTEN/NOTIFY` is a future optimization).
