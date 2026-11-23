import { BUILD_STATUSES, type BuildStatus, WorkflowTransitionError } from '@aab/shared-types';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  CANCELLABLE_STATUSES,
  RETRYABLE_STATUSES,
  assertTransition,
  canTransition,
} from './workflow-state-machine';

function walk(path: BuildStatus[]): void {
  for (let i = 1; i < path.length; i++) {
    assertTransition(path[i - 1] as BuildStatus, path[i] as BuildStatus);
  }
}

describe('WorkflowStateMachine', () => {
  it('defines transitions for every status', () => {
    expect(Object.keys(ALLOWED_TRANSITIONS).sort()).toEqual([...BUILD_STATUSES].sort());
  });

  it('allows the happy path', () => {
    expect(() =>
      walk(['PENDING', 'QUEUED', 'PLANNING', 'GENERATING', 'TESTING', 'COMPLETED']),
    ).not.toThrow();
  });

  it('allows the repair loop', () => {
    expect(() => walk(['TESTING', 'REPAIRING', 'TESTING', 'COMPLETED'])).not.toThrow();
  });

  it('allows repair failure', () => {
    expect(canTransition('REPAIRING', 'FAILED')).toBe(true);
  });

  it('allows approval pause and resume', () => {
    expect(() => walk(['GENERATING', 'WAITING_APPROVAL', 'GENERATING'])).not.toThrow();
  });

  it('allows cancellation from every cancellable status', () => {
    for (const status of CANCELLABLE_STATUSES) {
      expect(canTransition(status, 'CANCELLED')).toBe(true);
    }
  });

  it('treats COMPLETED as final', () => {
    for (const status of BUILD_STATUSES) {
      expect(canTransition('COMPLETED', status)).toBe(false);
    }
  });

  it('only allows retry (→ PENDING) from FAILED or CANCELLED', () => {
    for (const status of BUILD_STATUSES) {
      expect(canTransition(status, 'PENDING')).toBe(RETRYABLE_STATUSES.has(status));
    }
  });

  it.each<[BuildStatus, BuildStatus]>([
    ['PENDING', 'COMPLETED'],
    ['QUEUED', 'TESTING'],
    ['PLANNING', 'COMPLETED'],
    ['COMPLETED', 'CANCELLED'],
    ['FAILED', 'COMPLETED'],
    ['CANCELLED', 'PLANNING'],
  ])('rejects %s → %s', (from, to) => {
    expect(() => assertTransition(from, to)).toThrow(WorkflowTransitionError);
  });
});
