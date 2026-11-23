import { assertTransition } from '@aab/agent-core';
import {
  type BuildStatus,
  NotFoundError,
  TERMINAL_BUILD_STATUSES,
  isTerminalBuildStatus,
} from '@aab/shared-types';
import { Prisma, type PrismaClient } from './generated/prisma/client';

/**
 * Persistence for workflow state shared by the control plane (create, cancel,
 * retry, dispatch) and the execution plane (step progress).
 *
 * Every status change locks the build row (SELECT … FOR UPDATE), validates the
 * transition against the explicit state machine, bumps the optimistic
 * `version`, and appends an event with a monotonic per-build `sequence` — all
 * in one transaction, so concurrent writers (API cancel vs. worker progress)
 * serialize instead of racing.
 */

export interface ErrorInfo {
  code: string;
  message: string;
  details?: Prisma.InputJsonValue;
}

export interface TransitionInput {
  buildJobId: string;
  to: BuildStatus;
  message: string;
  /** Only apply when the current status is one of these (otherwise no-op). */
  expectedFrom?: readonly BuildStatus[];
  /** Only apply when the build is still on this attempt (stale-delivery guard). */
  attempt?: number;
  step?: string | null;
  metadata?: Prisma.InputJsonValue;
  error?: ErrorInfo | null;
  workerId?: string | null;
  /** Idempotency key for the emitted event (duplicate deliveries add nothing). */
  dedupeKey?: string;
}

export type TransitionResult =
  | { applied: true; from: BuildStatus; to: BuildStatus; attempt: number; version: number }
  | {
      applied: false;
      current: BuildStatus;
      attempt: number;
      reason: 'unexpected_status' | 'stale_attempt';
    };

interface LockedBuild {
  id: string;
  status: BuildStatus;
  attempt: number;
  version: number;
}

export async function lockBuild(
  tx: Prisma.TransactionClient,
  buildJobId: string,
): Promise<LockedBuild> {
  const rows = await tx.$queryRaw<LockedBuild[]>`
    SELECT id, status::text AS status, attempt, version
    FROM build_jobs WHERE id = ${buildJobId}::uuid FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new NotFoundError(`Build job ${buildJobId} not found`);
  return row;
}

async function nextSequence(tx: Prisma.TransactionClient, buildJobId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ next: number }[]>`
    SELECT COALESCE(MAX(sequence), 0)::int + 1 AS next
    FROM build_job_events WHERE build_job_id = ${buildJobId}::uuid`;
  return rows[0]?.next ?? 1;
}

export interface AppendEventInput {
  buildJobId: string;
  attempt: number;
  type: string;
  message: string;
  step?: string | null;
  fromStatus?: BuildStatus | null;
  toStatus?: BuildStatus | null;
  metadata?: Prisma.InputJsonValue;
  dedupeKey?: string;
}

/**
 * Append an event. Caller must hold the build row lock (inside a transaction
 * that called lockBuild). Duplicate dedupeKeys are silently skipped.
 */
export async function appendEventLocked(
  tx: Prisma.TransactionClient,
  input: AppendEventInput,
): Promise<void> {
  const sequence = await nextSequence(tx, input.buildJobId);
  await tx.buildJobEvent.createMany({
    data: [
      {
        buildJobId: input.buildJobId,
        sequence,
        attempt: input.attempt,
        type: input.type,
        message: input.message,
        step: input.step ?? null,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        metadata: input.metadata ?? {},
        dedupeKey: input.dedupeKey ?? null,
      },
    ],
    skipDuplicates: true,
  });
}

/** Append a non-status event (progress, log, decision) in its own transaction. */
export async function appendEvent(prisma: PrismaClient, input: AppendEventInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockBuild(tx, input.buildJobId);
    await appendEventLocked(tx, input);
  });
}

/** Status transition inside an existing transaction (caller passes tx). */
export async function transitionLocked(
  tx: Prisma.TransactionClient,
  input: TransitionInput,
): Promise<TransitionResult> {
  const build = await lockBuild(tx, input.buildJobId);
  if (input.attempt !== undefined && build.attempt !== input.attempt) {
    return {
      applied: false,
      current: build.status,
      attempt: build.attempt,
      reason: 'stale_attempt',
    };
  }
  if (input.expectedFrom && !input.expectedFrom.includes(build.status)) {
    return {
      applied: false,
      current: build.status,
      attempt: build.attempt,
      reason: 'unexpected_status',
    };
  }
  assertTransition(build.status, input.to);

  const now = new Date();
  const isRetry = input.to === 'PENDING' && TERMINAL_BUILD_STATUSES.has(build.status);
  const attempt = isRetry ? build.attempt + 1 : build.attempt;
  const version = build.version + 1;

  await tx.buildJob.update({
    where: { id: build.id },
    data: {
      status: input.to,
      version,
      attempt,
      ...(input.step !== undefined ? { currentStep: input.step } : {}),
      ...(input.workerId !== undefined ? { workerId: input.workerId } : {}),
      ...(input.to === 'PLANNING' ? { startedAt: now } : {}),
      ...(isTerminalBuildStatus(input.to) ? { completedAt: now } : {}),
      ...(input.error
        ? {
            errorCode: input.error.code,
            errorMessage: input.error.message,
            errorDetails: input.error.details ?? {},
          }
        : {}),
      ...(isRetry
        ? {
            repairAttempts: 0,
            errorCode: null,
            errorMessage: null,
            errorDetails: Prisma.DbNull,
            cancelRequestedAt: null,
            completedAt: null,
            startedAt: null,
            currentStep: null,
            workerId: null,
          }
        : {}),
    },
  });

  await appendEventLocked(tx, {
    buildJobId: build.id,
    attempt,
    type: 'STATUS_CHANGED',
    message: input.message,
    step: input.step ?? null,
    fromStatus: build.status,
    toStatus: input.to,
    metadata: input.error
      ? { ...(isJsonObject(input.metadata) ? input.metadata : {}), errorCode: input.error.code }
      : (input.metadata ?? {}),
    ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
  });

  return { applied: true, from: build.status, to: input.to, attempt, version };
}

/** Status transition in its own transaction. */
export async function transitionBuild(
  prisma: PrismaClient,
  input: TransitionInput,
): Promise<TransitionResult> {
  return prisma.$transaction((tx) => transitionLocked(tx, input));
}

function isJsonObject(value: unknown): value is Record<string, Prisma.InputJsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
