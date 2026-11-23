import { AuthenticationError, AuthorizationError } from '@aab/shared-types';
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../infrastructure/prisma.service';
import type { AppRequest } from '../http/request';
import { IS_PUBLIC } from './decorators';
import {
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
  JWT_AUDIENCE,
  JWT_ISSUER,
  SESSION_COOKIE,
  type SessionClaims,
} from './session';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global authentication guard (centralized: every route is protected unless
 * marked @Public). Accepts `Authorization: Bearer <jwt>` or the session cookie.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AppRequest>();
    const { token, viaCookie } = extractToken(req);
    if (!token) throw new AuthenticationError();
    if (viaCookie && !SAFE_METHODS.has(req.method) && req.get(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
      throw new AuthorizationError('Missing CSRF protection header');
    }

    let claims: SessionClaims;
    try {
      claims = await this.jwt.verifyAsync<SessionClaims>(token, {
        algorithms: ['HS256'],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
    } catch {
      throw new AuthenticationError('Invalid or expired session');
    }

    // Re-check the user still exists so deleted accounts lose access immediately.
    const user = await this.prisma.client.user.findUnique({
      where: { id: claims.sub },
      select: { id: true, email: true },
    });
    if (!user) throw new AuthenticationError('Invalid or expired session');
    req.user = user;
    return true;
  }
}

function extractToken(req: AppRequest): { token?: string; viaCookie: boolean } {
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return { token: header.slice(7).trim(), viaCookie: false };
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  const cookie = cookies?.[SESSION_COOKIE];
  return cookie ? { token: cookie, viaCookie: true } : { viaCookie: false };
}
