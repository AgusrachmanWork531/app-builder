import { ExternalProviderError } from '@aab/shared-types';
import { classifyFetchError, classifyHttpError } from './errors';

export type FetchFn = typeof fetch;

/** Upper bound on a provider response body (a JSON completion is far smaller). */
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface PostJsonOptions {
  provider: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
  fetchFn: FetchFn;
}

async function readBounded(response: Response, provider: string): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new ExternalProviderError(`${provider} response exceeds ${MAX_RESPONSE_BYTES} bytes`, {
      retryable: false,
    });
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new ExternalProviderError(`${provider} response exceeds ${MAX_RESPONSE_BYTES} bytes`, {
        retryable: false,
      });
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * POST JSON with a hard timeout covering the whole exchange (headers AND
 * body) that also honours the caller's AbortSignal. Errors are classified for
 * retry decisions and never include credentials or response bodies.
 */
export async function postJson(options: PostJsonOptions): Promise<unknown> {
  const timeout = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    timeout.abort();
  }, options.timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout.signal])
    : timeout.signal;
  const classify = (error: unknown) =>
    error instanceof ExternalProviderError
      ? error
      : classifyFetchError(options.provider, error, timedOut, options.signal?.aborted ?? false);

  try {
    let response: Response;
    try {
      response = await options.fetchFn(options.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...options.headers },
        body: JSON.stringify(options.body),
        signal,
      });
    } catch (error) {
      throw classify(error);
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw classifyHttpError(
        options.provider,
        response.status,
        response.headers.get('retry-after'),
      );
    }

    let text: string;
    try {
      text = await readBounded(response, options.provider);
    } catch (error) {
      throw classify(error);
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new ExternalProviderError(`${options.provider} returned a non-JSON response`, {
        retryable: true,
        cause: error,
      });
    }
  } finally {
    clearTimeout(timer);
  }
}
