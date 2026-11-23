import { randomBytes } from 'node:crypto';
import type { ApiEnv } from '@aab/shared-config';
import { AuthenticationError } from '@aab/shared-types';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from 'argon2';
import { JWT_AUDIENCE, JWT_ISSUER, type SessionClaims } from '../../common/auth/session';
import { API_ENV } from '../../config/api-env.token';
import { PrismaService } from '../../infrastructure/prisma.service';

export interface SessionResult {
  user: { id: string; email: string; displayName: string | null };
  accessToken: string;
  expiresInSeconds: number;
}

@Injectable()
export class AuthService implements OnModuleInit {
  /** Verified against when the email is unknown, so timing does not reveal account existence. */
  private dummyHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hash(randomBytes(32).toString('hex'));
  }

  async login(email: string, password: string): Promise<SessionResult> {
    const user = await this.prisma.client.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true, email: true, displayName: true, passwordHash: true },
    });
    const valid = await verify(user?.passwordHash ?? this.dummyHash, password).catch(() => false);
    if (!user || !valid) throw new AuthenticationError('Invalid email or password');

    const claims: SessionClaims = { sub: user.id, email: user.email };
    const accessToken = await this.jwt.signAsync(claims, {
      algorithm: 'HS256',
      expiresIn: this.env.JWT_EXPIRES_IN_SECONDS,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    return {
      user: { id: user.id, email: user.email, displayName: user.displayName },
      accessToken,
      expiresInSeconds: this.env.JWT_EXPIRES_IN_SECONDS,
    };
  }

  async me(userId: string): Promise<SessionResult['user']> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, displayName: true },
    });
    if (!user) throw new AuthenticationError();
    return user;
  }
}
