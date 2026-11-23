# AI App Builder Engine

Engineering foundation for a platform that turns natural-language requirements into
full-stack applications. This MVP delivers a **runnable, tested, asynchronous build
pipeline** with clear boundaries for real AI agents:

**Create Project → Submit Requirement → Create Build → Queue → Worker → Artifacts → Completion → View Result**

> **Mock-first.** Code generation runs on a deterministic **mock agent** and **mock
> sandbox**; every artifact is labeled `MOCK`. Requirement analysis uses a deterministic
> template matcher by default, or a real LLM (e.g. **Midas / `deepseek-v4-pro`**) when
> configured. Nothing here executes AI-generated code. See
> [Known limitations](#known-limitations).

## Architecture

Modular monolith control plane + independent AI workers + sandbox boundary.

```
 Browser ──► Next.js web (:3000) ──/api/v1 proxy──► NestJS API (:4000) ──► PostgreSQL
                                                     │   ▲                  (source of truth)
                                    transactional    │   │ SSE (tails events)
                                    outbox → BullMQ  ▼   │
                                                   Redis ──► AI worker(s) ──► Sandbox (mock)
                                                              state machine     artifacts on disk
```

| Part            | Path             | Responsibility                                                                                                                       |
| --------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Control plane   | `apps/api`       | Auth, projects, requirements, builds, outbox dispatch, SSE, reconciliation, artifacts, git export, LLM usage                         |
| Execution plane | `apps/ai-worker` | Consumes build jobs; runs the workflow (plan → generate → test → repair)                                                             |
| Web             | `apps/web`       | Dashboard, projects, live build view                                                                                                 |
| Shared          | `packages/*`     | Types/errors, env config, logger/metrics, job contracts, state machine & agent interfaces, Prisma DB, sandbox adapters, LLM adapters |

Details: [docs/architecture/overview.md](docs/architecture/overview.md) ·
[data model](docs/architecture/data-model.md) ·
[build lifecycle](docs/workflows/build-lifecycle.md) ·
[security](docs/security/security.md) · [API](docs/api/README.md) · [ADRs](docs/adr/) ·
[AGENTS.md](AGENTS.md)

## Prerequisites

- **Node.js 24 LTS** (`nvm use` reads `.nvmrc`). Node 23 is not supported by Prisma 7.
- **pnpm 10+** (developed with 12.x)
- **Docker** with Compose v2 (PostgreSQL 17 + Redis 7.4)
- `git` (only for the "Export to git" feature)
- Google Chrome (only for `pnpm test:e2e`; Playwright uses the installed Chrome)

## Setup

```bash
nvm use                      # Node 24
pnpm install
cp .env.example .env         # then set JWT_SECRET (openssl rand -hex 32) and DEV_SEED_PASSWORD
pnpm infra:up                # PostgreSQL :5432, Redis :6379 (override with POSTGRES_PORT / REDIS_PORT)
pnpm db:migrate
pnpm db:seed                 # dev user dev@example.com / DEV_SEED_PASSWORD (refuses outside dev/test)
pnpm dev                     # API :4000, worker, web :3000
```

Open http://localhost:3000 and log in as `dev@example.com`.

If port 6379 is taken by a local Redis, set `REDIS_PORT=6380` and
`REDIS_URL=redis://localhost:6380` in `.env`.

## Commands

| Command                                              | Does                                                                                                       | Needs                                |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `pnpm install`                                       | Install workspace deps                                                                                     | —                                    |
| `pnpm infra:up` / `infra:down`                       | Start/stop PostgreSQL + Redis                                                                              | Docker                               |
| `pnpm db:migrate`                                    | Apply Prisma migrations                                                                                    | PostgreSQL                           |
| `pnpm db:migrate:dev`                                | Create a new migration from schema changes                                                                 | PostgreSQL                           |
| `pnpm db:seed`                                       | Seed dev user + sample project                                                                             | PostgreSQL                           |
| `pnpm dev`                                           | API + worker + web with watch                                                                              | PostgreSQL, Redis                    |
| `pnpm dev:api` / `dev:worker` / `dev:web`            | Start one app (restart independently)                                                                      | PostgreSQL, Redis (web: none)        |
| `pnpm build`                                         | Build all packages and apps                                                                                | —                                    |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check` | Static checks                                                                                              | —                                    |
| `pnpm test`                                          | Unit tests (no infra)                                                                                      | —                                    |
| `pnpm test:integration`                              | Integration tests (real DB, Redis, BullMQ) on a dedicated `<db>_test` database (auto-created and migrated) | PostgreSQL, Redis                    |
| `pnpm test:e2e`                                      | Build + Playwright E2E on an isolated stack (API :4100, web :3100)                                         | PostgreSQL, Redis, seeded DB, Chrome |

## Using it

- **Mock scenarios** (project page): _Succeeds_, _Fails once, repaired_ (TESTING → REPAIRING →
  TESTING → COMPLETED), _Fails after max repairs_ (→ FAILED). Disabled in production.
- **Live progress** over Server-Sent Events; **Cancel** (cooperative while running) and
  **Retry** (new attempt, bounded by `MAX_BUILD_ATTEMPTS`).
- **Artifacts** download as attachments; **Export to git (local)** commits a completed
  build to a platform-owned repository under `ARTIFACT_STORAGE_PATH/repos/`.
- **API docs**: http://localhost:4000/api/docs (enabled in development/test only).

### Real LLM (Midas / DeepSeek v4)

```bash
LLM_PROVIDER=midas
MIDAS_BASE_URL=https://<gateway-host>/v1     # OpenAI-compatible; https required outside dev
MIDAS_API_KEY=<secret>                        # server-side only
# LLM_MODEL empty → deepseek-v4-pro
```

Model ids must exist on the gateway (`GET <MIDAS_BASE_URL>/models` lists them; e.g.
`deepseek-v4-pro`, `dpe/unlimited/deepseek-v4.1-flash`, `dpe/alias/deepseek-flash`). An unknown
id returns HTTP 404 → `EXTERNAL_PROVIDER_ERROR`. The gateway may route an id to a different
underlying model (observed: `deepseek-v4-pro` answered by `…deepseek-v4-flash…`); the model
reported by the gateway is what `llm_usage_records.model` stores.

Requirement analysis then calls the model; its output is validated against the
specification schema, token usage is stored in `llm_usage_records`, and calls are
limited per user (`LLM_REQUESTS_PER_USER_PER_MINUTE`) and per instance
(`LLM_MAX_CONCURRENCY`). `openai` and `anthropic` providers work the same way. Tests
never call a real provider.

## Testing

- **Unit** (`pnpm test`): state machine, errors, env validation, contracts, sandbox
  guards, LLM adapters (mocked fetch), analyzers, processors.
- **Integration** (`pnpm test:integration`): auth/CSRF, cross-user isolation, idempotency,
  outbox recovery, BullMQ processing, repair/cancel/retry, SSE, reconciliation,
  archive races, artifact download/cleanup, git export, Midas via a fake gateway.
- **E2E** (`pnpm test:e2e`): the 8-step user journey, repair loop and negative cases.

## Troubleshooting

| Symptom                                              | Fix                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `Prisma only supports Node.js 20.19+, 22.12+, 24.0+` | `nvm use 24`                                                                                                 |
| `Invalid environment configuration: NODE_ENV …`      | `NODE_ENV` is required (no default)                                                                          |
| `Ports are not available … 6379`                     | Set `REDIS_PORT`/`REDIS_URL` to another port                                                                 |
| API `/health/ready` returns 503                      | `pnpm infra:up`; check `DATABASE_URL`/`REDIS_URL`                                                            |
| Build stays `PENDING`                                | API (outbox dispatcher) not running                                                                          |
| Build stays `QUEUED`                                 | No worker running (`pnpm dev:worker`); stale builds are failed by the reconciler after `STALE_BUILD_SECONDS` |
| Requirement creation returns 502/429 with a real LLM | Check `MIDAS_BASE_URL`/key/model; 429 = provider or per-user limit                                           |

## Known limitations

- Code generation, validation and repair are **mock**; no AI-generated code is built or run.
  Real execution requires a hardened sandbox provider (microVM/gVisor) — see
  [security](docs/security/security.md).
- No remote GitHub/GitLab integration (would require secret storage and approval gates).
- JWT sessions are stateless (logout clears the cookie but does not revoke the token).
- No login/request rate limiting except for paid LLM calls; CSP still allows inline scripts.
- LLM `cost_usd` is not computed (no price table); metrics are emitted as structured logs.
