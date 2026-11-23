# System architecture

## Style

**Modular monolith (control plane) + independently deployable AI workers (execution
plane) + an isolated sandbox boundary.** PostgreSQL is the source of truth for all
business state; Redis/BullMQ only transports work. See ADRs 0001–0006.

```
                       ┌──────────────────────── Control plane (apps/api, NestJS) ───────────────────────┐
 Browser ─► Next.js ───┤ AuthGuard ─► Projects │ Requirements │ Builds │ Dashboard │ Artifacts │ Integrations │
  (web)   /api/v1      │                       │  Analyzer    │ Outbox │           │  Store    │  LocalGit    │
          proxy        │ LlmUsageService ─► LLM adapters (mock | midas | openai | anthropic)                 │
                       │ OutboxDispatcher ─► BullMQ        BuildReconciler        SSE stream (tails events) │
                       └───────────────┬──────────────────────────────▲────────────────────────────────────┘
                                       │ PostgreSQL (truth)           │
                          Redis/BullMQ │                              │
                       ┌───────────────▼──── Execution plane (apps/ai-worker) ──────────────┐
                       │ processor ─► BuildWorkflow (state machine, control loop, repair)    │
                       │                 ├─ AgentRuntime (MockAgentRuntime)                  │
                       │                 └─ SandboxProvider (MockSandboxProvider) ─► disk    │
                       └─────────────────────────────────────────────────────────────────────┘
```

## Module boundaries

| Module / package                               | Owns                                                                                               | Must not                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `apps/api/modules/auth`                        | Login, JWT, global `AuthGuard`, CSRF rule                                                          | —                                       |
| `apps/api/modules/projects`                    | Projects + **`ProjectAccessService`** (all ownership checks, project row locks)                    | Bypass `ProjectAccessService`           |
| `apps/api/modules/requirements`                | Prompt normalization, `RequirementAnalyzer` (mock or LLM), revisions                               | Trust LLM output without Zod validation |
| `apps/api/modules/jobs`                        | Build create/cancel/retry, outbox, dispatcher, SSE, reconciler, stream limits                      | Execute workflow steps                  |
| `apps/api/modules/llm`                         | Provider wiring, per-user rate limit, concurrency cap, usage records                               | Expose credentials                      |
| `apps/api/modules/artifacts`                   | `ArtifactStore`, download, retention cleanup                                                       | Render artifacts inline                 |
| `apps/api/modules/integrations`                | `GitProvider` (local only), git export                                                             | Run generated code                      |
| `apps/api/modules/dashboard`                   | User-scoped read model                                                                             | Cross-user queries                      |
| `apps/ai-worker`                               | `BuildWorkflow`, processor, retry classification, metrics                                          | Accept HTTP traffic                     |
| `packages/agent-core`                          | State machine, `AgentRuntime`/`SandboxProvider`/`ArtifactStore` interfaces, spec & options schemas | Infrastructure code                     |
| `packages/database`                            | Prisma schema/migrations, **workflow-store** (row-locked transitions + events)                     | Business rules beyond state persistence |
| `packages/sandbox-adapters`                    | `MockSandboxProvider`, `LocalArtifactStore`, path guards                                           | Command execution                       |
| `packages/llm-adapters`                        | Provider-independent LLM interface and adapters                                                    | Persistence                             |
| `packages/shared-*`, `logger`, `job-contracts` | Types/errors, env validation, logging/metrics, queue contracts                                     | —                                       |

Dependencies point inward: apps → packages; `agent-core` and `shared-types` depend on
nothing infrastructural.

## Data flow (happy path)

1. `POST /projects`, `POST /projects/:id/requirements` → analyzer produces an
   `AppSpecification` (revisioned, under the project row lock).
2. `POST /projects/:id/builds` → one transaction: `build_jobs` (PENDING) + first event +
   `outbox_messages` row → **202**.
3. `OutboxDispatcher` claims the row (`FOR UPDATE SKIP LOCKED`), publishes to BullMQ with
   `jobId = <buildId>_a<attempt>`, marks it published and transitions PENDING → QUEUED.
4. Worker validates the payload, re-reads the build from PostgreSQL and runs
   PLANNING → GENERATING → TESTING (→ REPAIRING …) → COMPLETED, writing plan, tasks,
   artifacts, checkpoints and events.
5. Browser follows `GET /builds/:id/stream` (SSE) and fetches detail/artifacts.

## Control plane vs execution plane

- The API never executes workflow steps or generated code; it only records intent
  (create/cancel/retry) and reads state.
- Workers scale horizontally (`WORKER_CONCURRENCY` per process, any number of processes).
  They coordinate exclusively through PostgreSQL row locks and BullMQ.
- Cancellation is cooperative: the API sets `cancel_requested_at`; the worker's control
  loop aborts the in-flight step and persists `CANCELLED`.

## Queue architecture

- Queue `build-jobs` (prefix `QUEUE_PREFIX`), one job per build attempt, payload carries
  identifiers only (`schemaVersion: 1`).
- Transient failures: up to 3 BullMQ attempts (2 retries) with exponential backoff + jitter; permanent
  failures throw `UnrecoverableError` after persisting `FAILED`.
- Publication failures leave the outbox row PENDING with capped backoff; orphaned rows
  (build deleted) are marked FAILED and never block others.
- `BuildReconciler` fails (or cancels) QUEUED/running builds whose heartbeat is stale and
  whose BullMQ job is no longer live.
- **One database ↔ one queue namespace.** Every API instance connected to a database
  dispatches that database's outbox rows to _its_ `REDIS_URL` + `QUEUE_PREFIX`. All API
  and worker processes sharing a database must therefore use the same Redis and prefix
  (E2E uses its own database `<db>_e2e` for this reason). After changing `REDIS_URL` or
  `QUEUE_PREFIX`, restart API and workers together.

## Web → API proxy

The browser only talks to the web origin. `apps/web/src/app/api/v1/[...path]/route.ts`
forwards `/api/v1/*` to `API_INTERNAL_URL` **at runtime** (fixed base URL, path segments
validated, an allow-list of request headers, `Set-Cookie` passed through, streaming for
SSE, upstream aborted when the client disconnects). This keeps the session cookie
same-origin for both `fetch` and `EventSource`.

## Sandbox boundaries

`SandboxProvider` creates one workspace per build attempt
(`ARTIFACT_STORAGE_PATH/workspaces/<buildId>_a<n>`). The mock provider only reads/writes
files (path traversal, symlink and size guards) and **refuses all command execution**.
A real provider must run in a hardened microVM/container — requirements in
[security.md](../security/security.md).
