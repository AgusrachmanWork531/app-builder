# Security

## Threat assumptions

- Users are authenticated but may be malicious towards **other users** (IDOR, CSRF,
  resource abuse) and towards the **platform** (prompt injection, cost abuse).
- **All AI output is untrusted**: LLM replies, generated specifications and generated code.
- Generated code must be assumed hostile once real execution exists: it may try to read
  secrets, reach the network, escape the filesystem or exhaust resources.
- The platform metadata database and its credentials are high-value targets.

## Implemented controls

| Area              | Control                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication    | Argon2 hashes; dummy-hash timing equalization; JWT HS256 with issuer/audience, re-checked user on every request; httpOnly `SameSite=Lax` cookie (`Secure` outside dev); bearer token only returned with `?responseMode=token`                                                                                           |
| CSRF              | Cookie-authenticated unsafe methods require `X-Requested-With: aab-web`; no CORS enabled; same-origin web proxy                                                                                                                                                                                                         |
| Authorization     | Global guard (all routes protected unless `@Public`); centralized `ProjectAccessService`; non-owners get **404**; SSE re-checks access periodically                                                                                                                                                                     |
| Input             | Zod on every body/query/header; UUID params; 256 kB body limit; strict PATCH schema (no mass assignment); prompt control-character stripping                                                                                                                                                                            |
| Concurrency       | Row locks for build and project state; idempotency keys; deduplicated events                                                                                                                                                                                                                                            |
| Error/log hygiene | Uniform error envelope; generic 500s; internal worker errors never shown; Pino redaction of passwords, tokens, cookies, API keys, DB URLs; whitelisted event metadata                                                                                                                                                   |
| Config            | Fail-fast env validation; `NODE_ENV` required; placeholder or short `JWT_SECRET` rejected outside dev; `https` required for the LLM gateway outside dev; secrets only in env, never committed                                                                                                                           |
| HTTP headers      | Helmet (API); CSP, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, HSTS in production (web)                                                                                                                                                                                                                     |
| LLM               | Requirement text passed as delimited data with explicit anti-injection instructions; output parsed + Zod-validated (identifiers restricted, provenance set server-side); provider errors never echo bodies or keys; response size and time bounded; per-user rate limit (fail closed) + concurrency cap; usage recorded |
| Artifacts         | Owner-checked; served only as `attachment` with `application/octet-stream`, `nosniff`, `CSP: sandbox`; storage confined to the root, symlinks refused, size-capped; retention + cleanup                                                                                                                                 |
| Git               | `execFile` with fixed argv (no shell); isolated `HOME`/config, hooks, fsmonitor, ssh, protocols and symlinks disabled; `.git` writes rejected after normalization; platform-owned repos only; advisory lock per repo                                                                                                    |
| Streams           | Per-user (5) and per-instance (200) SSE caps; idle backoff; bounded lifetime                                                                                                                                                                                                                                            |
| Seed              | Dev seed refuses to run unless `NODE_ENV` is development/test                                                                                                                                                                                                                                                           |

## Sandbox security requirements (for a real provider)

The shipped `MockSandboxProvider` **never executes commands**. Before enabling real
execution, a provider must guarantee, per build attempt:

- Hardened isolation: microVM (Firecracker/Kata) or gVisor — **a plain Docker container is
  not sufficient** for untrusted code. No privileged mode, no Docker socket, no host mounts.
- Read-only base image; writable scratch limited to the workspace; non-root user;
  seccomp/AppArmor; dropped capabilities.
- Default-deny network egress (allow-list package registries via a proxy if needed).
- CPU, memory, PIDs, disk and wall-clock limits; command timeouts; output size limits.
- No platform secrets in the runtime; generated apps get their **own** database
  credentials, never the platform `DATABASE_URL`.
- Workspace destroyed after artifact collection; full audit log of executed commands.

## Credential management

- All provider keys (`MIDAS_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) and
  `JWT_SECRET` live only in server-side environment variables; they are never sent to the
  browser, worker payloads, logs or error messages.
- Production should load secrets from a secret manager and rotate `JWT_SECRET`
  (rotation invalidates sessions).
- Remote Git credentials (future) must come from a secret store with per-project scoping.

## Approval boundaries

Operations that require an explicit human approval (`WAITING_APPROVAL`) before they may be
implemented: destructive database changes in generated apps, external deployment, pushing
to or modifying existing repositories (GitHub/GitLab), and enabling network or real
command execution in a sandbox. None of these are implemented in the MVP; the state
machine and the `ApprovalRequiredError` category exist for them.

## Known MVP limitations

- Stateless JWT: logout does not revoke tokens (needs a `jti`/session-version check).
- No login or general request rate limiting (only paid LLM calls are limited).
- CSP allows `'unsafe-inline'` scripts (needs nonce-based CSP via middleware).
- Downloads are buffered in memory (10 MB cap) rather than streamed.
- Single-region local artifact storage; object storage adapter not implemented.
- Metrics are structured logs only; no alerting on LLM spend (`cost_usd` not computed).
