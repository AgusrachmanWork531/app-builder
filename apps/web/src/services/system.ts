import 'server-only';

export type Readiness = { ok: true } | { ok: false; reason: string };

/** Server-side readiness probe against the API (not proxied through the browser). */
export async function getApiReadiness(): Promise<Readiness> {
  const base = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${base}/health/ready`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? { ok: true } : { ok: false, reason: `HTTP ${res.status}` };
  } catch {
    // Network failure: API process not running or unreachable.
    return { ok: false, reason: 'unreachable' };
  }
}
