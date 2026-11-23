# ADR 0003: BullMQ on Redis for job transport

- Status: Accepted
- Date: 2026-11-23

## Context

We need a reliable queue with retries, backoff, delayed jobs, stalled-job detection and
good Node.js support, without introducing heavy workflow infrastructure (Temporal etc.)
for an MVP whose workflow is a short linear state machine.

## Decision

Use BullMQ (Redis backend). Payloads carry identifiers only (versioned with Zod,
`schemaVersion: 1`); job ids are deterministic per attempt (`<buildId>_a<n>`) for
deduplication; transient failures retry 3× with exponential backoff and jitter;
permanent failures use `UnrecoverableError`. Publication goes through a transactional
outbox so a committed build is never lost if Redis is down.

## Consequences

- Redis is transport, not truth: losing Redis loses queued jobs but not builds; the
  reconciler surfaces affected builds as FAILED for retry.
- Redis must run with `maxmemory-policy noeviction`.
- If workflows grow branching, long waits or human steps at scale, revisit a workflow
  engine (Temporal) — the state machine and workflow-store are the seams.
