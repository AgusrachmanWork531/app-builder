# ADR 0002: Independent AI workers (execution plane)

- Status: Accepted
- Date: 2026-11-23

## Context

Build execution is long-running, CPU/IO heavy, may call slow external providers and will
eventually drive sandboxes running untrusted code. Running it inside the API would couple
request latency to build load and put untrusted execution next to user sessions and
secrets.

## Decision

Run workflows in a separate Node.js process (`apps/ai-worker`) that consumes BullMQ jobs,
reads/writes state only through PostgreSQL (shared `workflow-store`), and has no HTTP
surface. Concurrency is configured per process (`WORKER_CONCURRENCY`); processes scale
horizontally.

## Consequences

- API and workers deploy, scale and restart independently (`pnpm dev:api` / `dev:worker`).
- Workers must tolerate at-least-once delivery: every step is idempotent and re-reads
  persisted state; cancellation is cooperative through the database.
- A crashed worker is recovered by BullMQ stall detection or the API reconciler.
