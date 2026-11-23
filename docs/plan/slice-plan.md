# AI App Builder Engine — Vertical Slice Plan

Source spec: [master-prompt.md](./master-prompt.md) · Orchestrator: `orch-build-mvp` · Size tier: **large**

Slices are ordered as thin end-to-end paths: S1 is the full required vertical slice
(Create Project → Submit Requirement → Build Job → Queue → Worker → Mock Artifacts →
Completion → View Result) at minimum depth; later slices deepen it.

## Locked decisions

| Area                   | Decision                                                                                                                                         | Reason                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Node                   | `.nvmrc` = 24 (LTS); `engines.node >=22`                                                                                                         | Spec requires LTS; local v23 still runs                                           |
| TypeScript             | 6.0.3, `strict: true`                                                                                                                            | TS 7 (native compiler) is new; NestJS decorator metadata tooling is proven on 6.x |
| Prisma                 | 7.10.1 (stable)                                                                                                                                  | npm `latest` tag is 8.0.0-rc                                                      |
| Shared DB access       | `packages/database` (Prisma schema + client) used by API and worker                                                                              | Both planes persist workflow state; one schema owner                              |
| Unit/integration tests | Vitest + `unplugin-swc` (decorators) + Supertest                                                                                                 | One runner across all packages                                                    |
| E2E                    | Playwright                                                                                                                                       | Spec                                                                              |
| Auth                   | Argon2 password hashing; JWT in httpOnly cookie (web) **and** `Authorization: Bearer` (API clients/tests)                                        | SSE (`EventSource`) cannot send headers; cookie keeps SSE authorized              |
| Web → API              | Next.js rewrites proxy `/api/*` to the API                                                                                                       | Same-origin cookies, no CORS credentials juggling                                 |
| Queue dispatch         | Transactional outbox table; API dispatcher polls with `FOR UPDATE SKIP LOCKED`; BullMQ `jobId = buildJobId`                                      | DB commit + queue publish failure is recoverable; duplicate publish is deduped    |
| Job status truth       | PostgreSQL `build_jobs.status` + `build_job_events`; worker checks status before each step                                                       | Spec: Postgres is source of truth; tolerate duplicate deliveries                  |
| State machine          | Pure transition table in `packages/agent-core`, used by API (cancel/retry) and worker                                                            | Single definition, unit-tested                                                    |
| Mock analyzer          | Deterministic templates (e.g. "todo/task manager"); unknown prompts get a generic spec flagged `analyzer: "mock", matchedTemplate: null`         | Spec forbids implying NL understanding                                            |
| Sandbox                | `MockSandboxProvider` writes into a per-build dir under `ARTIFACT_STORAGE_PATH`, path-traversal guarded; `executeCommand` refuses real execution | Real execution disabled until a hardened provider is configured                   |

## Slices

### S0 — Scaffold (pipeline Phase 3)

pnpm workspace, base tsconfig, ESLint/Prettier, Vitest config, root scripts; `apps/api` (NestJS),
`apps/ai-worker`, `apps/web` (Next.js) shells; packages `shared-types`, `shared-config` (Zod env),
`job-contracts`, `logger` (Pino), `database` (Prisma schema for all 10 tables + outbox, initial
migration, seed), `agent-core` (state machine); `docker-compose.yml` (Postgres, Redis, healthchecks,
volumes, 127.0.0.1 ports); `/health/live`, `/health/ready` (DB + Redis).
**Done:** `pnpm install`, `pnpm typecheck`, `pnpm lint` pass; `pnpm infra:up` healthy; `pnpm db:migrate`

- `db:seed` succeed; `/health/ready` 200; worker boots and connects to Redis; state-machine unit tests pass.

### S1 — Walking skeleton (the required vertical slice) · security trigger

API: login (seed user), `POST/GET /projects`, `POST/GET /projects/:id/requirements` (MockRequirementAnalyzer),
`POST /projects/:id/builds` (202, Idempotency-Key, outbox), `GET /builds/:id`, `GET /builds/:id/events`,
ownership guard, response envelope + requestId, Swagger.
Worker: BullMQ consumer → validates payload → PLANNING (execution plan + tasks) → GENERATING (mock
artifacts via MockSandbox, artifact rows) → TESTING (mock validation) → COMPLETED, events persisted.
Web: login, create project + prompt, start build, build page showing status/events (polling).
**Done:** integration test drives the full slice to COMPLETED against real Postgres + Redis; user B
cannot read user A's project (403/404); invalid payloads 400; same Idempotency-Key returns same build.

### S2 — Live progress & build control · security trigger

SSE `GET /builds/:id/stream` (authorized); cancel + retry endpoints; controlled simulated failure →
REPAIRING (bounded) → FAILED with persisted error; retry classification, exponential backoff + jitter,
build timeout, graceful worker shutdown, stale-job reconciliation; web build detail uses SSE with
retry/cancel buttons.
**Done:** tests for cancel mid-run, simulated failure → FAILED after max repairs, retry creates new
attempt, invalid transitions rejected, unauthorized SSE rejected.

### S3 — Dashboard & project management

Dashboard (counts, recent projects/builds, status summary); project list with pagination, detail,
PATCH, archive; requirement revisions; build history per project.
**Done:** API tests for pagination/patch/archive; web screens with loading/error/empty states.

### S4 — Provider boundaries · security trigger

LLM module: provider interface, MockLLM, OpenAI + Anthropic adapters initialized only with valid keys,
timeout, error classification, `llm_usage_records`. Artifact module: storage abstraction, local
storage, owner-checked download, expiry cleanup. Contexts/checkpoints. Integration module: Git provider
interface + local adapter + approval gate. Metrics interface (job duration, retries, queue wait, tokens).
**Done:** unit tests for error classification, adapter selection without keys, artifact access control,
path traversal rejection.

### S5 — E2E, docs, final report

Playwright E2E for the 8-step user flow + negative cases; README, docs/architecture, docs/workflows,
docs/security, ADRs 1–6, AGENTS.md; final engineering report with the validation table.
**Done:** `pnpm test`, `pnpm test:e2e`, `pnpm lint`, `pnpm typecheck`, `pnpm build` all pass.

## Execution per slice

Implement (TDD) → GAN evaluator loop (`--eval-mode code-only` for S0/S2/S4, `playwright` for S1/S3/S5)
→ `code-reviewer` (+ `security-reviewer` on S1, S2, S4) → **Gate 2** → one `feat:` commit per slice.
