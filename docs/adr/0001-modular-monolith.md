# ADR 0001: Modular monolith for the control plane

- Status: Accepted
- Date: 2026-11-23

## Context

The control plane covers auth, projects, requirements, builds, orchestration state,
artifacts, LLM configuration and integrations. These share one database, one
authorization model and one transactional boundary (e.g. build + event + outbox in one
transaction). The team is small and the domain boundaries are still moving.

## Decision

Build the control plane as a single NestJS application with strict module boundaries
(`apps/api/src/modules/*`), shared domain code in `packages/*`, and cross-module access
only through exported services (notably `ProjectAccessService`).

## Consequences

- One deployable, one transaction scope, simple local development and testing.
- No distributed transactions or network hops between modules.
- Boundaries are enforced by convention and module exports rather than process isolation;
  modules can be extracted later because they communicate through services and the DB
  schema is owned by `packages/database`.
- Scaling is per process (horizontal API replicas are safe: outbox and reconciler use
  row locks / `SKIP LOCKED`).
