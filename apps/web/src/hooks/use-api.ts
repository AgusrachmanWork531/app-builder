'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClientError } from '@/services/api-client';

export interface ApiState<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  reload: () => Promise<void>;
}

/**
 * Load data on mount; redirects to /login on 401 and exposes loading/error
 * state for the page to render.
 */
export function useApi<T>(loader: () => Promise<T>, deps: readonly unknown[]): ApiState<T> {
  const router = useRouter();
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  // Monotonic request id: a slower, older response must never overwrite a newer one.
  const latestRequest = useRef(0);

  const reload = useCallback(async () => {
    const requestId = ++latestRequest.current;
    try {
      const result = await loader();
      if (requestId !== latestRequest.current) return;
      setData(result);
      setError(undefined);
    } catch (e) {
      if (requestId !== latestRequest.current) return;
      if (e instanceof ApiClientError && e.isUnauthenticated) {
        router.replace('/login');
        return;
      }
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
    // `loader` is recreated each render; `deps` is the caller's explicit dependency list.
  }, deps);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload };
}

/** Normalize an unknown thrown value into a user-facing message. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong';
}
