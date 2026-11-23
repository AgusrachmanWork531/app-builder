# Build lifecycle

## State machine

Defined once in `packages/agent-core/src/workflow-state-machine.ts` and enforced on every
persisted transition.

```
PENDING ──► QUEUED ──► PLANNING ──► GENERATING ──► TESTING ──► COMPLETED
   │           │           │  ▲          │  ▲          │  ▲
   │           │           ▼  │          ▼  │          ▼  │
   │           │      WAITING_APPROVAL ◄─┘  │      REPAIRING
   │           │                            │   (bounded rounds)
   └───────────┴────── any non-terminal ────┴──► CANCELLED / FAILED

FAILED | CANCELLED ──retry──► PENDING (attempt + 1, bounded by max_attempts)
COMPLETED is final.
```

| From              | Allowed to                                      |
| ----------------- | ----------------------------------------------- |
| PENDING           | QUEUED, CANCELLED, FAILED                       |
| QUEUED            | PLANNING, CANCELLED, FAILED                     |
| PLANNING          | GENERATING, WAITING_APPROVAL, FAILED, CANCELLED |
| GENERATING        | TESTING, WAITING_APPROVAL, FAILED, CANCELLED    |
| TESTING           | COMPLETED, REPAIRING, FAILED, CANCELLED         |
| REPAIRING         | TESTING, FAILED, CANCELLED                      |
| WAITING_APPROVAL  | PLANNING, GENERATING, FAILED, CANCELLED         |
| FAILED, CANCELLED | PENDING (retry)                                 |
| COMPLETED         | —                                               |

`WAITING_APPROVAL` is modelled and allowed but no step requests approval yet.

## Lifecycle

1. **Create** (API): build PENDING + event + outbox row in one transaction → 202.
   `Idempotency-Key` returns the original build for repeats (also under races).
2. **Dispatch** (API): outbox → BullMQ → PENDING → QUEUED.
3. **Execute** (worker): PLANNING (plan + tasks) → GENERATING (files + artifact rows,
   `expires_at = now + ARTIFACT_RETENTION_DAYS`) → TESTING (validation report).
4. **Repair**: failed validation → REPAIRING (round counter committed atomically with the
   transition) → TESTING, up to `MAX_REPAIR_ATTEMPTS`; then FAILED (`BUILD_FAILURE`).
5. **Complete**: COMPLETED with artifact count; cancellation is re-checked just before.

## Retries

| Layer          | Bound                                                 | Trigger                                                                                                               |
| -------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| BullMQ job     | 3 attempts, exponential backoff 2 s × 2ⁿ ± 50% jitter | Retryable errors: provider 5xx/429/timeouts, DB/Redis connectivity (Prisma P1001/P1002/P1008/P1017/P2024/P2028/P2034) |
| Repair loop    | `MAX_REPAIR_ATTEMPTS` (default 2)                     | Validation failure                                                                                                    |
| User retry     | `max_attempts` = `MAX_BUILD_ATTEMPTS` (default 3)     | Explicit `POST /builds/:id/retry` on FAILED/CANCELLED                                                                 |
| Outbox publish | 10 attempts, capped backoff (≤ 60 s)                  | Redis unavailable                                                                                                     |

Non-retryable errors (validation, unknown bugs) persist FAILED immediately and the queue
job fails with `UnrecoverableError`. Internal error messages are never shown to users.

## Cancellation

- PENDING / QUEUED / WAITING_APPROVAL → CANCELLED immediately.
- Running states → `cancel_requested_at` + `CANCEL_REQUESTED` event; the worker control
  loop (500 ms) aborts the in-flight step via `AbortSignal`, terminates the workspace and
  persists CANCELLED. A cancel on a finished build returns 409.

## Recovery (worker failure, duplicate delivery)

- Jobs are delivered **at least once**. Every step re-reads persisted status; transitions
  carry `expectedFrom` + `attempt`; events and artifacts are deduplicated; plans are
  get-or-create. A redelivered job resumes from its persisted step (including mid-repair).
- Benign races (e.g. the worker reads PENDING before the dispatcher commits QUEUED)
  continue from the persisted status; terminal or newer-attempt builds stop the delivery.
- Crashed worker: BullMQ's stalled-job detection redelivers the job while it is live.
  If the queue job is gone, `BuildReconciler` (every `RECONCILE_INTERVAL_MS`) fails —
  or cancels, if requested — QUEUED/running builds whose heartbeat is older than
  `STALE_BUILD_SECONDS`, so nothing waits forever.
- Timeout: `BUILD_TIMEOUT_SECONDS` aborts the attempt with a non-retryable `TIMEOUT`.
- Graceful shutdown: SIGTERM closes the worker (waits for active jobs, 30 s cap).
