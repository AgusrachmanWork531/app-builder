import type { Request } from 'express';

/** Authenticated principal attached by the auth guard. */
export interface AuthUser {
  id: string;
  email: string;
}

export type AppRequest = Request & { id?: string | number; user?: AuthUser };

export function requestIdOf(req: AppRequest): string {
  return typeof req.id === 'string' ? req.id : String(req.id ?? 'unknown');
}
