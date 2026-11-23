import { AppError, ExternalProviderError, ValidationError } from '@aab/shared-types';
import { type Job, UnrecoverableError } from 'bullmq';
import { describe, expect, it } from 'vitest';
import {
  publicMessage,
  remainingQueueAttempts,
  toQueueError,
  validatePayload,
} from './build-job.processor';

describe('build job processor helpers', () => {
  it('rejects payloads that violate the contract', () => {
    expect(() => validatePayload({ buildJobId: 'nope' })).toThrow(ValidationError);
  });

  it('maps non-retryable errors to UnrecoverableError', () => {
    expect(toQueueError(new ValidationError('bad'))).toBeInstanceOf(UnrecoverableError);
    expect(toQueueError(new Error('programming bug'))).toBeInstanceOf(UnrecoverableError);
  });

  it('keeps retryable errors retryable', () => {
    const error = new ExternalProviderError('upstream 503');
    expect(toQueueError(error)).toBe(error);
  });

  it('never exposes internal error messages', () => {
    expect(publicMessage(new AppError('INTERNAL_ERROR', 'db password=hunter2'))).toBe(
      'Internal worker error',
    );
    expect(publicMessage(new ValidationError('spec invalid'))).toBe('spec invalid');
  });

  it('computes remaining queue attempts (bounded retries)', () => {
    const job = (attempts: number, attemptsMade: number) =>
      ({ opts: { attempts }, attemptsMade }) as unknown as Job;
    expect(remainingQueueAttempts(job(3, 0))).toBe(2);
    expect(remainingQueueAttempts(job(3, 2))).toBe(0);
    expect(remainingQueueAttempts(job(1, 5))).toBe(0);
  });
});
