import { describe, expect, it } from 'vitest';
import {
  AppError,
  ApprovalRequiredError,
  CancellationError,
  ExternalProviderError,
  RateLimitError,
  ValidationError,
  toAppError,
} from './errors';

describe('error classification', () => {
  it('marks provider and rate-limit errors retryable', () => {
    expect(new ExternalProviderError('upstream 503').disposition).toBe('retryable');
    expect(new RateLimitError('429', 1000).disposition).toBe('retryable');
  });

  it('marks validation errors non-retryable', () => {
    expect(new ValidationError('bad').disposition).toBe('non_retryable');
  });

  it('distinguishes cancellation and approval-required', () => {
    expect(new CancellationError().disposition).toBe('cancelled');
    expect(new ApprovalRequiredError('needs approval').disposition).toBe('approval_required');
  });

  it('treats unknown errors as non-retryable internal errors', () => {
    const wrapped = toAppError(new TypeError('boom'));
    expect(wrapped).toBeInstanceOf(AppError);
    expect(wrapped.code).toBe('INTERNAL_ERROR');
    expect(wrapped.retryable).toBe(false);
  });

  it('passes AppError through unchanged', () => {
    const original = new ValidationError('x');
    expect(toAppError(original)).toBe(original);
  });
});
