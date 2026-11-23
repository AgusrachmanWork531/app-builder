# AGENTS.md — instructions for AI coding agents

Read `README.md`, `docs/architecture/overview.md` and `docs/workflows/build-lifecycle.md`
before changing behaviour. The original spec is `docs/plan/master-prompt.md`; the slice
plan and locked decisions are in `docs/plan/slice-plan.md`.

## Environment

- Node 24 (`nvm use`); pnpm workspaces. Never downgrade TypeScript strictness.
- Infra: `pnpm infra:up && pnpm db:migrate && pnpm db:seed`.
- Never read, print or commit `.env`; add new variables to `.env.example` and
  `packages/shared-config/src/env.ts` (validated, fail-fast).

## Repository conventions

- Apps: `apps/api` (NestJS control plane), `apps/ai-worker` (execution plane),
  `apps/web` (Next.js). Shared code: `packages/*` (`@aab/<name>`), CommonJS output via
  `tsc`, imported from `dist` (run `pnpm build:packages` after changing a package).
- Validation with Zod at every boundary (HTTP, queue payloads, env, LLM output).
- Errors: throw typed `AppError` subclasses from `@aab/shared-types`; never swallow errors
  silently; never put secrets or provider bodies in messages.
- Logging: Pino via `@aab/logger` with context fields (`buildId`, `projectId`, …);
  metrics through the `Metrics` interface.
- Formatting: Prettier (`pnpm format`); lint: ESLint flat config.

## Naming

- Files kebab-case (`build-workflow.ts`); classes PascalCase; DI tokens `UPPER_SNAKE`.
- DB tables/columns snake_case via Prisma `@map`; models PascalCase.
- Tests: `*.test.ts` (packages/worker unit), `*.spec.ts` (API unit), `*.int-spec.ts`
  (integration, real infra), `apps/web/e2e/*.spec.ts` (Playwright).

## Module ownership and boundaries

- Project ownership checks go through `ProjectAccessService` only; non-owners get 404.
- Build status changes go through `packages/database/src/workflow-store.ts` only
  (row lock + state machine + event). Never `update({ status })` directly.
- Project-scoped writes take the project lock (`lockOwnedProject`/`lockWritableProject`)
  inside the same transaction; lock order is project → build.
- The API never executes workflow steps or generated code; workers have no HTTP surface.
- Queue payloads carry identifiers only; workers re-read state from PostgreSQL.
- Schema changes: edit `schema.prisma`, run `pnpm db:migrate:dev --name <change>`,
  commit the migration. Use `Cascade`/`SetNull`, not `Restrict`, inside cascade chains.

## Security rules

- Treat all AI output and generated code as untrusted. Never execute it outside an
  approved sandbox provider; the mock sandbox must keep refusing commands.
- Never expose credentials to the browser, worker payloads, logs or errors.
- New endpoints are authenticated by default; mark `@Public()` only for health/login.
- Cookie-authenticated mutations require the CSRF header; keep CORS disabled.
- Generated artifacts are served as attachments only.
- Destructive or external operations (deploys, remote repos, destructive DB changes,
  sandbox network/exec) require an approval gate (`WAITING_APPROVAL`) — do not add them
  without one.
- Never claim a mock is production-ready; label mock output (`isMock`, `[MOCK]`).

## Testing requirements

- Unit tests for pure logic; integration tests (`pnpm test:integration`) for anything
  touching the DB, queue or HTTP; E2E for user-visible flows.
- Paid LLMs are never called in tests (use `MockLlmProvider` or a local fake gateway).
- Cover negative cases: unauthorized access (404 for other users), invalid payloads,
  invalid transitions, races where relevant.

## Definition of Done

1. `pnpm lint`, `pnpm typecheck`, `pnpm format:check` pass.
2. `pnpm test` and `pnpm test:integration` pass; `pnpm test:e2e` passes for UI changes.
3. New behaviour has tests, including failure paths.
4. Docs updated (README / architecture / workflows / security / ADR for decisions).
5. No secrets, `.env`, generated Prisma client or build output committed.
6. Mock vs real behaviour is stated honestly in code and docs.
