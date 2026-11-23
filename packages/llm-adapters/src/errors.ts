import {
  type AppError,
  CancellationError,
  ExternalProviderError,
  RateLimitError,
  TimeoutError,
} from '@aab/shared-types';

/**
 * Map an HTTP failure from an LLM provider to a typed, retry-classified error.
 * The response body is NOT echoed (it may contain prompt content or account
 * details); only the status and provider name are reported.
 */
export function classifyHttpError(
  provider: string,
  status: number,
  retryAfter: string | null,
): AppError {
  if (status === 429) {
    const seconds = retryAfter ? Number(retryAfter) : NaN;
    return new RateLimitError(
      `${provider} rate limit exceeded`,
      // Clamp: a hostile/buggy Retry-After must not schedule multi-year backoffs.
      Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 60) * 1000 : undefined,
      { details: { provider, status } },
    );
  }
  if (status === 408 || status >= 500) {
    return new ExternalProviderError(`${provider} is temporarily unavailable (HTTP ${status})`, {
      retryable: true,
      details: { provider, status },
    });
  }
  // 400/401/403/404/422: configuration or request problems — retrying won't help.
  return new ExternalProviderError(`${provider} rejected the request (HTTP ${status})`, {
    retryable: false,
    details: { provider, status },
  });
}

/** Map a thrown fetch error (network, timeout, caller abort). */
export function classifyFetchError(
  provider: string,
  error: unknown,
  timedOut: boolean,
  callerAborted: boolean,
): AppError {
  if (callerAborted) return new CancellationError(`${provider} request cancelled`);
  if (timedOut) return new TimeoutError(`${provider} request timed out`, { retryable: true });
  return new ExternalProviderError(`${provider} is unreachable`, {
    retryable: true,
    cause: error,
    details: { provider },
  });
}
