# REST API (`/api/v1`)

Interactive OpenAPI docs: **http://localhost:4000/api/docs** (JSON at `/api/docs-json`;
enabled in development/test, or with `API_DOCS_ENABLED=true`).

## Conventions

- Success: `{ "success": true, "data": …, "meta": { "requestId": "…", "pagination"? } }`
- Error: `{ "success": false, "error": { "code", "message", "retryable", "details"? }, "meta": { "requestId" } }`
- `X-Request-ID` is accepted (`[A-Za-z0-9._-]{1,128}`) or generated, and echoed back.
- Auth: `Authorization: Bearer <jwt>` or the `aab_session` cookie. Cookie-authenticated unsafe
  requests (POST, PATCH, PUT, DELETE) need `X-Requested-With: aab-web`.
- Status codes: 400 validation · 401 unauthenticated · 403 forbidden/CSRF · 404 not found
  (also for other users' resources) · 409 conflict/invalid transition/archived ·
  429 rate limited · 502 provider error · 504 timeout.

## Endpoints

| Method | Path                                                   | Notes                                                                                         |
| ------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| POST   | `/auth/login`                                          | Sets cookie; `?responseMode=token` also returns the bearer token                              |
| POST   | `/auth/logout`                                         | Clears cookie                                                                                 |
| GET    | `/auth/me`                                             | Current user                                                                                  |
| GET    | `/dashboard`                                           | Counts, recent projects/builds, status summary                                                |
| POST   | `/projects`                                            | Create                                                                                        |
| GET    | `/projects?status=active\|archived\|all&page&pageSize` | Paginated (pageSize ≤ 100)                                                                    |
| GET    | `/projects/:id`                                        | Owner only                                                                                    |
| PATCH  | `/projects/:id`                                        | `name`, `description` (archived → 409)                                                        |
| POST   | `/projects/:id/archive` · `/unarchive`                 | Archive refused while builds run                                                              |
| POST   | `/projects/:id/requirements`                           | `{ prompt }` (10–5000 chars) → analyzed revision                                              |
| GET    | `/projects/:id/requirements`                           | Newest first                                                                                  |
| POST   | `/projects/:id/builds`                                 | **202**; optional `Idempotency-Key`, body `{ requirementId?, options?: { simulateFailure } }` |
| GET    | `/projects/:id/builds`                                 | Paginated history                                                                             |
| GET    | `/builds/:buildId`                                     | Detail incl. plan and artifacts (with ids, expiry)                                            |
| GET    | `/builds/:buildId/events?afterSequence&limit`          | Ordered history                                                                               |
| GET    | `/builds/:buildId/stream`                              | **SSE**: `build-event` (id = sequence), `status`, `end`; supports `Last-Event-ID`             |
| POST   | `/builds/:buildId/cancel`                              | 202 `{ build, cancellation: completed\|requested }`                                           |
| POST   | `/builds/:buildId/retry`                               | 202, new attempt                                                                              |
| GET    | `/builds/:buildId/artifacts/:artifactId/download`      | Attachment                                                                                    |
| POST   | `/builds/:buildId/git-export`                          | COMPLETED only; local platform repo                                                           |
| GET    | `/health/live` · `/health/ready`                       | Unauthenticated, no envelope (ready checks DB + Redis)                                        |
