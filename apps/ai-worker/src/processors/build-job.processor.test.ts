import { ExternalProviderError, ValidationError } from '@aab/shared-types';
import { UnrecoverableError } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { toQueueError, validatePayload } from './build-job.processor';

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
});
