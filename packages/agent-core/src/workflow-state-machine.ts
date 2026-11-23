import { type BuildStatus, WorkflowTransitionError } from '@aab/shared-types';

/**
 * Explicit allowed transitions for a build job.
 *
 * Happy path:   PENDING → QUEUED → PLANNING → GENERATING → TESTING → COMPLETED
 * Repair loop:  TESTING → REPAIRING → TESTING (bounded by MAX_REPAIR_ATTEMPTS)
 * Approval:     PLANNING|GENERATING → WAITING_APPROVAL → PLANNING|GENERATING
 * Cancellation: any non-terminal state → CANCELLED
 * Retry:        FAILED|CANCELLED → PENDING (new attempt, explicit user action only)
 *
 * COMPLETED has no outgoing transitions.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<BuildStatus, readonly BuildStatus[]>> = {
  PENDING: ['QUEUED', 'CANCELLED', 'FAILED'],
  QUEUED: ['PLANNING', 'CANCELLED', 'FAILED'],
  PLANNING: ['GENERATING', 'WAITING_APPROVAL', 'FAILED', 'CANCELLED'],
  GENERATING: ['TESTING', 'WAITING_APPROVAL', 'FAILED', 'CANCELLED'],
  TESTING: ['COMPLETED', 'REPAIRING', 'FAILED', 'CANCELLED'],
  REPAIRING: ['TESTING', 'FAILED', 'CANCELLED'],
  WAITING_APPROVAL: ['PLANNING', 'GENERATING', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: ['PENDING'],
  CANCELLED: ['PENDING'],
};

/** States from which a user may request cancellation. */
export const CANCELLABLE_STATUSES: ReadonlySet<BuildStatus> = new Set<BuildStatus>([
  'PENDING',
  'QUEUED',
  'PLANNING',
  'GENERATING',
  'TESTING',
  'REPAIRING',
  'WAITING_APPROVAL',
]);

/** States from which a user may request a retry (starts a new attempt). */
export const RETRYABLE_STATUSES: ReadonlySet<BuildStatus> = new Set<BuildStatus>([
  'FAILED',
  'CANCELLED',
]);

/** States in which the worker is actively executing the workflow. */
export const ACTIVE_STATUSES: ReadonlySet<BuildStatus> = new Set<BuildStatus>([
  'PLANNING',
  'GENERATING',
  'TESTING',
  'REPAIRING',
]);

export function canTransition(from: BuildStatus, to: BuildStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: BuildStatus, to: BuildStatus): void {
  if (!canTransition(from, to)) {
    throw new WorkflowTransitionError(`Invalid build status transition ${from} → ${to}`, {
      details: { from, to, allowed: ALLOWED_TRANSITIONS[from] },
    });
  }
}
