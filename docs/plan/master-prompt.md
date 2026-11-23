# MASTER PROMPT — AI APP BUILDER ENGINE

> Source: master prompt pasted by the user (2026-11-23). Saved verbatim so plan-orchestrate commands can reference `docs/plan/master-prompt.md#step-N`, where step N = PHASE N in section 21.

## 1. ROLE & RESPONSIBILITY

Act as an expert software engineering team consisting of: Principal Software Architect, Senior AI Engineer, Senior Backend Engineer, Agentic AI Systems Engineer, Platform / DevOps Engineer, Database Architect, Application Security Engineer, Senior QA Automation Engineer.

You are responsible for designing, implementing, testing, and documenting a scalable, secure, maintainable AI App Builder Engine.

**IMPORTANT: Your responsibility is to EXECUTE the implementation, not merely explain an architecture or propose a folder structure.**

Create real files, configure dependencies, implement core functionality, run available validation commands, inspect failures, and fix them.

Do not claim something works unless you have verified it.

---

## 2. PROJECT OBJECTIVE

Project Name: **AI App Builder Engine**

Build the engineering foundation for a platform capable of converting natural-language instructions into full-stack applications.

Future target workflow:

1. User submits an application requirement.
2. AI analyzes the requirement.
3. AI generates structured specifications.
4. AI creates a development plan.
5. AI generates database, backend, and frontend code.
6. AI executes tools in an isolated environment.
7. AI performs build and automated testing.
8. AI attempts to repair detected errors.
9. AI stores project artifacts and execution history.
10. User receives the generated application, source code, and preview.

The initial implementation must prioritize **a working architecture and execution pipeline**.

Do not attempt to implement every advanced AI capability during initial scaffolding.

Use a functional Mock Agent and Mock Sandbox when real integrations are not yet configured.

Clearly distinguish mock implementations from production-ready integrations.

---

## 3. ARCHITECTURAL DECISIONS

### Primary Architecture

**Modular Monolith + Distributed AI Workers + Isolated Sandbox**

### A. Control Plane (NestJS Modular Monolith)

Authentication and authorization; project management; requirement management; build request management; AI orchestration coordination; job scheduling; workflow state persistence; context management; LLM provider configuration; Git integration configuration; build status and progress reporting; artifact metadata management.

### B. Execution Plane (independently deployable Node.js/TypeScript workers)

Receiving queued jobs; running AI coding tasks; executing workflow steps; managing coding agent sessions; coordinating sandbox execution; running automated validation; handling retry and repair loops; reporting execution results.

### C. Sandbox Layer

Isolated filesystem; controlled command execution; dependency installation; application build; database migration; testing; artifact collection; runtime cleanup.

Generated code must never execute directly inside the API server process.

### Architectural Rules

- Apply Clean Architecture principles where useful.
- Use clear module boundaries.
- Follow SOLID, DRY, KISS, and YAGNI.
- Prefer composition over unnecessary inheritance.
- Use dependency injection.
- Separate domain logic from infrastructure adapters.
- Avoid circular module dependencies.
- Do not introduce full microservices prematurely.
- Allow horizontal scaling of workers.
- Design for future extraction of independent services.
- Keep infrastructure dependencies behind interfaces.
- Avoid excessive abstraction without concrete use cases.

---

## 4. REQUIRED TECHNOLOGY STACK

### Core Platform

TypeScript; Active Node.js LTS; pnpm; pnpm Workspaces Monorepo; NestJS; Next.js + React; Zod; PostgreSQL; Prisma; BullMQ; Redis; Pino; Swagger / OpenAPI; Docker Compose.

### AI & Agent Infrastructure

- LLM Providers: OpenAI and Anthropic
- Coding Agent Runtime: Pluggable adapter
- Agent Orchestration: Custom lightweight orchestration initially
- Structured Output: Zod / JSON Schema
- Context Persistence: PostgreSQL
- Context Cache: Redis where necessary
- Tool Integration: MCP-compatible architecture
- Sandbox: Provider-independent sandbox adapter

### Testing

- Unit Testing: Jest or Vitest, selected consistently
- Backend Integration Testing: Supertest
- Web E2E Testing: Playwright
- Static Analysis: ESLint
- Formatting: Prettier
- Type Safety: TypeScript strict mode

Avoid installing LangGraph, Temporal, CrewAI, and other orchestration frameworks unless a concrete architectural requirement justifies them. Use one primary implementation per responsibility.

---

## 5. MONOREPO STRUCTURE

    ai-app-builder/
    ├── apps/
    │   ├── web/src/{app,components,features,hooks,services,types}
    │   ├── api/src/{common,config,modules/{auth,projects,requirements,orchestration,contexts,jobs,llm,artifacts,integrations},main.ts}
    │   └── ai-worker/src/{processors,agents,execution,sandbox,workflows,recovery,main.ts}
    ├── packages/{shared-types,shared-config,job-contracts,agent-core,llm-adapters,sandbox-adapters,logger}
    ├── infrastructure/{docker,database,monitoring}
    ├── docs/{architecture,api,workflows,security,adr}
    ├── scripts/
    ├── tests/
    ├── .env.example
    ├── docker-compose.yml
    ├── pnpm-workspace.yaml
    ├── package.json
    ├── AGENTS.md
    └── README.md

Adjust minor directory details when required by framework conventions. Do not create empty directories merely to match the tree. Every implemented module must have a clear responsibility.

---

## 6. CORE BACKEND MODULES

### 6.1 Project Module
Create, get detail, list, update metadata, archive project; associate project with build jobs; enforce project ownership. Entities: Project, ProjectSettings.

### 6.2 Requirement Module
Store raw user prompts; validate requirement payload; normalize requirement data; store structured application specifications; support requirement revisions. Implement a RequirementAnalyzer interface. Provide a deterministic MockRequirementAnalyzer that converts a supported sample request into a structured application specification. Do not claim that this mock understands arbitrary natural language.

### 6.3 Orchestration Module
Create execution plans; coordinate workflow steps; track workflow state; handle failure transitions; coordinate approval requests; resume from supported checkpoints. Provide WorkflowOrchestrator, WorkflowStateMachine, ExecutionPlanService, WorkflowEventService. Do not implement a complex multi-agent system yet.

### 6.4 Job Module
Create build jobs; dispatch jobs to BullMQ; track job status; support controlled retry; request cancellation; maintain execution history; implement idempotency. The source of truth for business job status must be PostgreSQL. Redis/BullMQ is responsible for queue processing. Design recovery for cases where the database transaction succeeds but queue publication fails. Prefer a minimal transactional outbox or a documented reconciliation strategy.

### 6.5 LLM Module
Provider-independent LLM interface; configured model selection; token usage tracking; request timeout; rate-limit handling; retryable error classification; execution metadata recording. Adapters: OpenAI, Anthropic, MockLLM. Keep credentials server-side. Initialize real providers only when valid configuration is supplied.

### 6.6 Context Module
Store workflow context; track task outputs; record technical decisions; store checkpoint references; retrieve relevant execution history. Do not add vector search until semantic retrieval is actually required.

### 6.7 Artifact Module
Record generated artifact metadata; associate artifacts with builds; store file references; provide controlled artifact access; support artifact expiration and cleanup. Use a storage abstraction. Implement local development storage safely, with object storage compatibility for future deployment.

### 6.8 Integration Module
Define Git provider interface; support local Git repository adapter; prepare GitLab/GitHub provider adapters; handle Git credentials securely; prevent unauthorized repository operations.

---

## 7. AI WORKER IMPLEMENTATION

The worker must: 1. Connect to BullMQ. 2. Subscribe to the build queue. 3. Receive a validated job payload. 4. Load project and workflow context. 5. Initialize the configured agent runtime. 6. Execute workflow steps. 7. Persist execution progress. 8. Report errors. 9. Release resources. 10. Acknowledge or fail the queue job appropriately.

Provide interfaces for: AgentRuntime, PlanningAgent, CodingAgent, ValidationAgent, SandboxProvider, ToolExecutor, ArtifactStore. For the initial skeleton, a single AgentRuntime may implement the workflow. Do not create multiple operational AI agents unless they are necessary for the working vertical slice.

### Mock Agent Mode
Deterministic mock implementations that: generate an execution plan; create sample project artifacts in the mock workspace; simulate completion of workflow steps; store execution events; produce a validated sample result; support a controlled simulated failure. All mock results must be clearly identified as mock.

### Real Agent Integration
Prepare an adapter boundary for a coding agent SDK. Do not assume arbitrary tool execution is safe. If feasible, implement one provider-backed adapter; otherwise provide a typed interface and documented integration requirements. Never fabricate successful AI execution.

---

## 8. WORKFLOW STATE MACHINE

Statuses: PENDING, QUEUED, PLANNING, GENERATING, TESTING, REPAIRING, WAITING_APPROVAL, COMPLETED, FAILED, CANCELLED.

Define allowed transitions explicitly.
- Success: PENDING → QUEUED → PLANNING → GENERATING → TESTING → COMPLETED
- Repair: TESTING → REPAIRING → TESTING → COMPLETED
- Failure: REPAIRING → FAILED
- Cancellation: any supported nonterminal state → CANCELLED, after cancellation is safely coordinated.

Do not allow invalid state transitions. Persist: current state, state transition events, timestamp, attempt number, error details, workflow checkpoint reference, execution metadata.

Requirements: idempotent job handling; bounded retries; exponential backoff with jitter where appropriate; maximum repair attempts; timeout; cancellation support; graceful worker shutdown; recovery after worker failure. Do not assume exactly-once job execution. Design external side effects to tolerate duplicate deliveries.

---

## 9. DATABASE DESIGN

PostgreSQL + Prisma migrations. Core tables: users, projects, project_requirements, build_jobs, build_job_events, execution_plans, execution_tasks, workflow_checkpoints, project_artifacts, llm_usage_records (+ outbox table if using transactional outbox).

Requirements: UUID primary keys; foreign keys; referential integrity; created/updated timestamps; enum or constrained workflow statuses; unique idempotency constraints; indexes for queue reconciliation and job lookup; proper cascade/delete strategy; migration scripts; minimal development seed data. Separate application metadata from generated application data. Never let generated applications use the platform metadata database with administrative privileges. Document each table and its purpose. Avoid premature denormalization.

---

## 10. API CONTRACT

REST versioning `/api/v1`.

- Projects: POST /api/v1/projects; GET /api/v1/projects; GET /api/v1/projects/:id; PATCH /api/v1/projects/:id
- Requirements: POST /api/v1/projects/:id/requirements; GET /api/v1/projects/:id/requirements
- Build Jobs: POST /api/v1/projects/:id/builds; GET /api/v1/projects/:id/builds; GET /api/v1/builds/:buildId; GET /api/v1/builds/:buildId/events; POST /api/v1/builds/:buildId/cancel; POST /api/v1/builds/:buildId/retry
- Streaming: GET /api/v1/builds/:buildId/stream (Server-Sent Events; authorization applies to SSE streams)
- System: GET /health/live; GET /health/ready

Standards: DTO validation; consistent response and error format; meaningful HTTP status codes; request ID / correlation ID; pagination; authentication; authorization; OpenAPI documentation; input sanitization; Idempotency-Key support for build creation.

    { "success": true, "data": {}, "meta": { "requestId": "uuid" } }

Asynchronous build creation returns HTTP 202 with a build identifier and initial status. Use real persisted statuses rather than hardcoded success responses.

---

## 11. SANDBOX & EXECUTION SECURITY

SandboxProvider interface: createWorkspace(), writeFile(), readFile(), listFiles(), executeCommand(), collectArtifacts(), terminateWorkspace(), cleanup(). Implement a MockSandboxProvider for development. Real code execution must be disabled unless a secure sandbox provider is explicitly configured.

Mandatory controls: no privileged container execution; no Docker socket exposed to generated code; no direct host filesystem access; no unrestricted process execution; no unrestricted network egress; no platform secrets inside generated application runtime; restricted filesystem paths; per-job resource limits; command timeout; output size limits; CPU/memory limits; safe workspace cleanup; credential isolation; audit logging.

A standard Docker container alone must not be assumed to provide sufficient isolation for arbitrary untrusted code. For real execution, require a hardened container or microVM-based environment with reviewed security controls. Use approval gates for dangerous operations, including destructive database changes, external deployment, or modification of existing repositories.

---

## 12. FRONTEND APPLICATION

Minimal but functional Next.js frontend.
- Dashboard: project count, recent projects, recent build jobs, build status summary.
- Project Creation: project name input, prompt input, create project action, requirement submission.
- Project Detail: project metadata, requirements, build history, current build status.
- Build Detail: current workflow state, execution step, event history, error summary, retry/cancel actions where permitted. Use SSE for live updates.

UI requirements: TypeScript strict mode; reusable components; API client abstraction; loading, error, and empty states; accessible form controls; basic responsive layout. Functional integration over appearance.

---

## 13. AUTHENTICATION & AUTHORIZATION

Secure password hashing for local credentials; JWT or session-based auth; centralized authorization; project ownership enforcement; protected build operations; protected artifact access; no hardcoded production credentials. A development seed user may be provided, but development-only credentials must not be enabled in production. Provide tests proving users cannot access other users' projects.

---

## 14. ENVIRONMENT CONFIGURATION

`.env.example` with: NODE_ENV, API_PORT, WEB_PORT, DATABASE_URL, REDIS_URL, JWT_SECRET, LLM_PROVIDER, OPENAI_API_KEY, ANTHROPIC_API_KEY, AGENT_RUNTIME, SANDBOX_PROVIDER, MAX_BUILD_ATTEMPTS, MAX_REPAIR_ATTEMPTS, BUILD_TIMEOUT_SECONDS, WORKER_CONCURRENCY, LOG_LEVEL, ARTIFACT_STORAGE_PATH.

Validate on startup; fail fast on invalid configuration; never commit real secrets; keep mock mode executable without paid AI API credentials; no insecure defaults in production.

---

## 15. INFRASTRUCTURE SETUP

Docker Compose with PostgreSQL and Redis (optional artifact-storage service only if genuinely needed). Health checks; persistent development volumes; service dependencies; environment configuration; network configuration; safe default port exposure. Separate commands for infrastructure startup, database migration, API startup, worker startup, web startup, full local development startup. Support independently restarting the API and AI worker. No Kubernetes for the MVP.

---

## 16. LOGGING & OBSERVABILITY

Structured logs (Pino) supporting: requestId, correlationId, projectId, buildId, taskId, workerId, executionStep, status, duration, errorCode. Foundational metrics/telemetry interfaces for: job duration, failed jobs, retry count, queue wait time, worker utilization, LLM token usage, LLM request cost. No full monitoring cluster unless necessary.

---

## 17. ERROR HANDLING & RECOVERY

Typed error categories: validation, authentication, authorization, external provider, rate limits, queue processing, sandbox failures, build failures, workflow transition, resource limit, cancellation. Distinguish retryable failure, non-retryable failure, cancellation, approval required. Never use unlimited retries. No empty catch blocks. Useful error messages without exposing secrets. Bounded repair loops; persist failed execution details.

---

## 18. TESTING REQUIREMENTS

- Unit: requirement validation, workflow state transitions, execution plan handling, retry classification, idempotency behavior, authorization rules.
- Integration: project creation, requirement persistence, build submission, BullMQ job processing, workflow persistence, build completion in mock mode, job failure, cancellation behavior.
- E2E: open app → authenticate → create project → submit prompt → start mock build → observe progress → receive completed status → inspect execution history.

Test negative cases (unauthorized access, invalid payloads). Mock external AI providers in CI. Do not require paid API keys for basic tests.

---

## 19. DEVELOPMENT SCRIPTS

pnpm install, pnpm dev, pnpm dev:api, pnpm dev:web, pnpm dev:worker, pnpm infra:up, pnpm infra:down, pnpm db:migrate, pnpm db:seed, pnpm build, pnpm lint, pnpm typecheck, pnpm test, pnpm test:e2e. Ensure these are actually defined. Document whether each requires PostgreSQL, Redis, Docker, or other dependencies. No nonfunctional scripts.

---

## 20. DOCUMENTATION REQUIREMENTS

- README.md: overview, architecture summary, prerequisites, installation, environment setup, development commands, API docs URL, mock mode instructions, testing instructions, troubleshooting.
- docs/architecture/: system architecture, module boundaries, data flow, control vs execution plane, queue architecture, sandbox boundaries.
- docs/workflows/: build lifecycle, state machine, retry and cancellation, recovery strategy.
- docs/security/: threat assumptions, sandbox security requirements, credential management, approval boundaries, known MVP limitations.
- docs/adr/: 1. Why Modular Monolith 2. Why independent workers 3. Why BullMQ 4. Why PostgreSQL for workflow state 5. Why sandbox isolation 6. Why agent/provider adapters.
- AGENTS.md: repository conventions, module ownership, naming conventions, testing requirements, architecture boundaries, security rules, Definition of Done.

---

## 21. IMPLEMENTATION PHASES

### PHASE 1 — Repository Foundation
Tasks: inspect the existing repository; identify existing files and dependencies; avoid overwriting user changes; initialize the monorepo; configure TypeScript; configure linting and formatting; set up shared packages; create foundational documentation.
Acceptance: workspace dependencies resolve; type checking works; initial projects compile.

### PHASE 2 — Infrastructure Foundation
Tasks: configure PostgreSQL; configure Redis; configure Docker Compose; implement Prisma schema; create database migrations; implement environment validation; implement structured logging.
Acceptance: infrastructure starts; health checks work; migrations complete.

### PHASE 3 — Backend Foundation
Tasks: implement NestJS modules; implement authentication; implement project APIs; implement requirement APIs; implement build-job APIs; implement OpenAPI documentation.
Acceptance: APIs respond correctly; authorization works; data persists.

### PHASE 4 — Worker Foundation
Tasks: configure BullMQ; create independent worker; implement job contracts; implement workflow state machine; implement mock agent runtime; implement mock sandbox; implement retry and cancellation; persist job events.
Acceptance: API can enqueue a job; worker consumes the job; workflow state changes correctly; mock build reaches a terminal state; events are stored.

### PHASE 5 — Frontend Foundation
Tasks: implement project dashboard; implement project creation; implement build submission; implement job progress screen; implement SSE updates; implement basic error handling.
Acceptance: user can create a project; user can submit a build; user can observe build progress.

### PHASE 6 — Validation & Stabilization
Tasks: run linting; run type checking; run unit tests; run integration tests; run available E2E tests; verify local startup; fix discovered errors; update documentation.
Acceptance: implemented functionality passes validation; no unresolved critical security issue in the MVP path; remaining limitations are documented.

---

## 22. IMPLEMENTATION RULES

1. Do not stop after generating an architecture document.
2. Create real executable project files.
3. Use the official framework conventions.
4. Prefer existing compatible dependencies.
5. Avoid unnecessary framework duplication.
6. Do not generate dead code.
7. Do not generate fake success responses.
8. Do not bypass failing tests to claim success.
9. Do not disable TypeScript strict mode to resolve errors.
10. Do not use `any` unnecessarily.
11. Do not expose secrets in logs.
12. Do not execute generated code outside approved sandboxes.
13. Do not silently perform destructive operations.
14. Implement clear and predictable error handling.
15. Maintain consistent naming and module boundaries.
16. Update documentation when architecture changes.
17. Complete and validate one phase before moving to the next.
18. When a command fails, inspect its actual output and diagnose the cause.
19. Do not continue building on top of known unresolved foundational errors.
20. Never claim a mock implementation is production-ready.

If an external service or credential is unavailable, implement the appropriate interface and a functional mock. If a requirement cannot be completed safely, document the limitation and continue with independently achievable work. Do not ask for confirmation of ordinary engineering decisions. Request approval only for destructive actions, sensitive access, or significant external side effects.

---

## 23. DEFINITION OF DONE

Monorepo initialized; Next.js frontend runs; NestJS API runs; AI Worker runs separately; PostgreSQL connection works; Redis/BullMQ integration works; migrations work; shared contracts compile; core API endpoints work; workflow state machine implemented; mock agent processes a build job; workflow events persisted; build progress observable; authentication and project authorization work; basic unit and integration tests pass; development setup documented; no secrets committed; unsupported integrations documented.

Required vertical slice: **Create Project → Submit Requirement → Create Build Job → Queue Job → Worker Execution → Mock Artifact Generation → Workflow Completion → View Result**

Real AI-generated application development, real sandbox execution, advanced repair loops, and deployment automation are subsequent capabilities unless explicitly implemented and validated.

---

## 24. FINAL REPORT FORMAT

A. Implementation Summary · B. Repository Structure · C. Validation Results table (Dependency installation, Type checking, Lint, Unit tests, Integration tests, Mock build workflow, API health — PASS/FAIL/BLOCKED with evidence) · D. How to Run · E. Known Limitations · F. Next Development Priorities.

---

## 25. START IMPLEMENTATION

Inspect the repository and environment, give a short plan, then build the foundation phase by phase. Prefer a smaller, fully working system over a large collection of incomplete modules.

**Final objective: deliver a runnable, testable, extensible AI App Builder Engine foundation with a working asynchronous mock build pipeline and clear boundaries for future real AI agent integration.**
