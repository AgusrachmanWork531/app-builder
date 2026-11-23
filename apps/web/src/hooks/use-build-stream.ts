'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/services/api-client';
import type { BuildDetail, BuildEvent, BuildStatus } from '@/types/api';
import { useApi } from './use-api';

export const TERMINAL_STATUSES: BuildStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];
const FALLBACK_POLL_MS = 2000;

export interface BuildStream {
  build: BuildDetail | undefined;
  events: BuildEvent[];
  error: string | undefined;
  loading: boolean;
  live: 'connecting' | 'live' | 'polling' | 'closed';
  /** Reload detail + events and reopen the live stream (e.g. after Retry). */
  refresh: () => Promise<void>;
}

/**
 * Build detail kept current via Server-Sent Events. Events arrive in sequence
 * order (deduplicated by sequence); status changes trigger a detail reload so
 * plan/artifacts stay in sync. Falls back to polling if SSE is unavailable or
 * the server refuses the stream, and reconnects when a new attempt starts.
 */
export function useBuildStream(id: string): BuildStream {
  const detail = useApi(() => api.getBuild(id), [id]);
  const [events, setEvents] = useState<BuildEvent[]>([]);
  const [live, setLive] = useState<BuildStream['live']>('connecting');
  const [connection, setConnection] = useState(0);
  const lastStatus = useRef<BuildStatus | undefined>(undefined);
  const reloadDetail = detail.reload;

  const mergeEvents = useCallback((incoming: BuildEvent[]) => {
    setEvents((current) => {
      const bySeq = new Map(current.map((e) => [e.sequence, e]));
      for (const e of incoming) bySeq.set(e.sequence, e);
      return [...bySeq.values()].sort((a, b) => a.sequence - b.sequence);
    });
  }, []);

  const reloadAll = useCallback(async () => {
    await reloadDetail();
    mergeEvents(await api.getBuildEvents(id).catch(() => []));
  }, [id, reloadDetail, mergeEvents]);

  const refresh = useCallback(async () => {
    await reloadAll();
    setConnection((n) => n + 1); // reopen the stream for a possibly new attempt
  }, [reloadAll]);

  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      setLive('polling');
      return;
    }
    setLive('connecting');
    const source = new EventSource(api.buildStreamUrl(id));
    let failures = 0;
    source.onopen = () => {
      failures = 0;
      setLive('live');
    };
    source.addEventListener('build-event', (msg) => {
      mergeEvents([JSON.parse((msg as MessageEvent<string>).data) as BuildEvent]);
    });
    source.addEventListener('status', (msg) => {
      const { status } = JSON.parse((msg as MessageEvent<string>).data) as { status: BuildStatus };
      if (status !== lastStatus.current) {
        lastStatus.current = status;
        void reloadDetail();
      }
    });
    source.addEventListener('end', () => {
      source.close();
      setLive('closed');
      void reloadAll();
    });
    source.onerror = () => {
      // Network blips are retried by EventSource itself. An HTTP error (401,
      // 404, 429, proxy failure) closes it permanently → fall back to polling.
      failures += 1;
      if (source.readyState === EventSource.CLOSED || failures >= 3) {
        source.close();
        setLive('polling');
      }
    };
    return () => source.close();
  }, [id, connection, mergeEvents, reloadDetail, reloadAll]);

  const status = detail.data?.status;
  const terminal = status ? TERMINAL_STATUSES.includes(status) : false;
  useEffect(() => {
    // Poll when SSE is unavailable, or if the stream closed but the build is
    // still running (e.g. it ended right before a new attempt began).
    if (terminal || (live !== 'polling' && live !== 'closed')) return;
    const timer = setInterval(() => void reloadAll(), FALLBACK_POLL_MS);
    return () => clearInterval(timer);
  }, [live, terminal, reloadAll]);

  return {
    build: detail.data,
    events,
    error: detail.error,
    loading: detail.loading,
    live,
    refresh,
  };
}
