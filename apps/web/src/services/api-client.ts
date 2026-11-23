import type { ApiResponse } from '@aab/shared-types';
import type {
  Build,
  BuildDetail,
  BuildEvent,
  PaginationMeta,
  Project,
  Requirement,
  User,
} from '@/types/api';

/** Error carrying the API's error envelope fields. */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Browser-side client for /api/v1 (same-origin, proxied by Next.js). Sends the
 * session cookie plus the CSRF header the API requires for mutations.
 */
async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T; pagination?: PaginationMeta }> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'aab-web',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiClientError(0, 'NETWORK_ERROR', 'Cannot reach the server');
  }
  const json = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!json)
    throw new ApiClientError(res.status, 'BAD_RESPONSE', `Unexpected response (${res.status})`);
  if (!json.success) throw new ApiClientError(res.status, json.error.code, json.error.message);
  return { data: json.data, pagination: json.meta.pagination };
}

const data = async <T>(path: string, options?: RequestOptions): Promise<T> =>
  (await request<T>(path, options)).data;

export const api = {
  login: (email: string, password: string) =>
    data<{ user: User }>('/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => data<{ loggedOut: true }>('/auth/logout', { method: 'POST' }),
  me: () => data<User>('/auth/me'),

  listProjects: (page = 1, pageSize = 20) =>
    request<Project[]>(`/projects?page=${page}&pageSize=${pageSize}`),
  createProject: (name: string, description?: string) =>
    data<Project>('/projects', { method: 'POST', body: { name, description } }),
  getProject: (id: string) => data<Project>(`/projects/${id}`),

  listRequirements: (projectId: string) =>
    data<Requirement[]>(`/projects/${projectId}/requirements`),
  createRequirement: (projectId: string, prompt: string) =>
    data<Requirement>(`/projects/${projectId}/requirements`, { method: 'POST', body: { prompt } }),

  listBuilds: (projectId: string) => request<Build[]>(`/projects/${projectId}/builds?pageSize=50`),
  createBuild: (projectId: string, idempotencyKey: string) =>
    data<Build>(`/projects/${projectId}/builds`, {
      method: 'POST',
      body: {},
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  getBuild: (id: string) => data<BuildDetail>(`/builds/${id}`),
  getBuildEvents: (id: string, afterSequence = 0) =>
    data<BuildEvent[]>(`/builds/${id}/events?afterSequence=${afterSequence}`),
};
