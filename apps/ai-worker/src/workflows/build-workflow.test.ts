import { describe, expect, it } from 'vitest';
import { resolveUnappliedTransition } from './build-workflow';

const unapplied = (
  current: Parameters<typeof resolveUnappliedTransition>[0]['current'],
  reason: 'unexpected_status' | 'stale_attempt' = 'unexpected_status',
) => ({ applied: false, current, attempt: 1, reason }) as const;

describe('resolveUnappliedTransition', () => {
  it('continues when the dispatcher queued the build first (PENDING read, QUEUED persisted)', () => {
    expect(resolveUnappliedTransition(unapplied('QUEUED'))).toBe('QUEUED');
  });

  it('continues from a step another delivery already reached', () => {
    expect(resolveUnappliedTransition(unapplied('GENERATING'))).toBe('GENERATING');
    expect(resolveUnappliedTransition(unapplied('REPAIRING'))).toBe('REPAIRING');
  });

  it.each(['COMPLETED', 'FAILED', 'CANCELLED'] as const)('stops when the build is %s', (status) => {
    expect(resolveUnappliedTransition(unapplied(status))).toBe('interrupt');
  });

  it('stops when the build left the pipeline (approval) or moved to a newer attempt', () => {
    expect(resolveUnappliedTransition(unapplied('WAITING_APPROVAL'))).toBe('interrupt');
    expect(resolveUnappliedTransition(unapplied('PLANNING', 'stale_attempt'))).toBe('interrupt');
  });
});
