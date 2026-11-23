import type { NextRequest } from 'next/server';

/**
 * Same-origin proxy for /api/v1/* → API_INTERNAL_URL, resolved at RUNTIME
 * (Next.js rewrites are frozen at build time, which would pin every deployment
 * to the build machine's API address). Streams responses, so Server-Sent
 * Events pass through, and aborts the upstream request when the client leaves.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'authorization',
  'content-type',
  'cookie',
  'idempotency-key',
  'last-event-id',
  'x-request-id',
  'x-requested-with',
];
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-encoding',
  'content-length',
]);

const MAX_BODY_BYTES = 256 * 1024;

function errorResponse(status: number, code: string, message: string, retryable: boolean) {
  return Response.json({ success: false, error: { code, message, retryable } }, { status });
}

function tooLarge() {
  return errorResponse(413, 'RESOURCE_LIMIT_EXCEEDED', 'Request body too large', false);
}

function apiBase(): string {
  return process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
}

async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (path.some((segment) => segment === '..' || segment === '.' || segment.includes('/'))) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid path', false);
  }
  const target = new URL(`/api/v1/${path.map(encodeURIComponent).join('/')}`, apiBase());
  target.search = request.nextUrl.search;

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

  // Bound memory before buffering: the API rejects > 256 kB anyway.
  let body: ArrayBuffer | undefined;
  if (hasBody) {
    if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return tooLarge();
    try {
      body = await request.arrayBuffer();
    } catch {
      return errorResponse(400, 'VALIDATION_ERROR', 'Could not read request body', false);
    }
    if (body.byteLength > MAX_BODY_BYTES) return tooLarge();
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
      signal: request.signal,
      cache: 'no-store',
    });
  } catch {
    // Client disconnects also land here; the response is then never delivered.
    return errorResponse(502, 'INTERNAL_ERROR', 'API unavailable', true);
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, name) => {
    if (!HOP_BY_HOP.has(name) && name !== 'set-cookie') responseHeaders.set(name, value);
  });
  for (const cookie of upstream.headers.getSetCookie())
    responseHeaders.append('set-cookie', cookie);
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
