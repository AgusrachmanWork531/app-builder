# Data model (platform metadata database)

PostgreSQL via Prisma (`packages/database/prisma/schema.prisma`, migrations in
`prisma/migrations`). UUID primary keys, `timestamptz` timestamps, enum-constrained
statuses. This database holds **platform metadata only**: generated applications must
never receive its `DATABASE_URL` or any role on it.

| Table                  | Purpose                                                                                                                              | Key constraints / indexes                                                                                          | Deletion                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `users`                | Accounts (argon2 password hash)                                                                                                      | `email` unique                                                                                                     | Cascades to owned projects                  |
| `projects`             | Owner, name, description, status (ACTIVE/ARCHIVED), settings JSON                                                                    | `(owner_id, status, updated_at)`                                                                                   | Cascades to requirements, builds, artifacts |
| `project_requirements` | Raw + normalized prompt, analyzed `specification` JSON, analyzer name, revision                                                      | `(project_id, revision)` unique                                                                                    | `created_by_id` set null if user deleted    |
| `build_jobs`           | Status (state machine), attempt, max attempts, repair count, options, error, worker, heartbeat, cancel request, optimistic `version` | `(requested_by_id, idempotency_key)` unique; `(status, updated_at)` for reconciliation; `(project_id, created_at)` | Cascades from project/requirement           |
| `build_job_events`     | Append-only history: status changes, plan, artifacts, validation, retries, cancel requests, git exports                              | `(build_job_id, sequence)` unique (SSE cursor); `(build_job_id, dedupe_key)` unique (idempotent writes)            | Cascade                                     |
| `execution_plans`      | Plan per build attempt                                                                                                               | `(build_job_id, attempt)` unique                                                                                   | Cascade                                     |
| `execution_tasks`      | Plan tasks with status and output (task outputs / decisions)                                                                         | `(plan_id, key)`, `(plan_id, position)` unique                                                                     | Cascade                                     |
| `workflow_checkpoints` | Minimal resumable state per step (`PLANNING`, `GENERATING`, `TESTING`, `REPAIRING-n`)                                                | `(build_job_id, attempt, step)` unique                                                                             | Cascade                                     |
| `project_artifacts`    | Artifact metadata: path, opaque storage key, size, sha256, content type, `is_mock`, `expires_at`                                     | `(build_job_id, attempt, path)` unique; `expires_at` index                                                         | Cascade; expired rows removed by cleanup    |
| `llm_usage_records`    | Per-call provider, model, purpose, tokens, latency, outcome, `cost_usd` (null until priced)                                          | `build_job_id`, `project_id`, `created_at` indexes                                                                 | Set null on project/build delete            |
| `outbox_messages`      | Transactional outbox for queue publication                                                                                           | `(status, available_at)`                                                                                           | Kept for audit                              |

## Concurrency rules

- **Build state** changes go through `packages/database/src/workflow-store.ts`:
  `SELECT … FOR UPDATE` on the build row, state-machine validation, `version + 1`, event
  with `MAX(sequence)+1` — one transaction.
- **Project-scoped writes** (archive, update, new requirement/build/retry) lock the project
  row first. Lock order is always **project → build**, so there are no deadlocks.
- Foreign keys use `CASCADE`/`SET NULL` only (never `RESTRICT`/`NO ACTION` inside cascade
  chains), because PostgreSQL fires RI checks in trigger order and could reject a
  cascading delete.
