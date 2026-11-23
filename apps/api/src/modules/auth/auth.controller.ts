import type { ApiEnv } from '@aab/shared-config';
import { Body, Controller, Get, HttpCode, Inject, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, Public } from '../../common/auth/decorators';
import { SESSION_COOKIE } from '../../common/auth/session';
import type { AuthUser } from '../../common/http/request';
import { openApiSchema } from '../../common/validation/openapi';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { API_ENV } from '../../config/api-env.token';
import { AuthService, type SessionResult } from './auth.service';

const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(256),
});
const responseModeSchema = z.enum(['cookie', 'token']).default('cookie');

type LoginResponse = Omit<SessionResult, 'accessToken'> & { accessToken?: string };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log in; sets an httpOnly session cookie and returns a bearer token' })
  @ApiBody({ schema: openApiSchema(loginSchema) })
  @ApiQuery({
    name: 'responseMode',
    required: false,
    enum: ['cookie', 'token'],
    description:
      '"token" also returns the bearer token in the body (API clients); default is cookie only',
  })
  async login(
    @Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>,
    @Query('responseMode', new ZodPipe(responseModeSchema)) responseMode: 'cookie' | 'token',
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const session = await this.auth.login(body.email, body.password);
    res.cookie(SESSION_COOKIE, session.accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.env.COOKIE_SECURE,
      path: '/',
      maxAge: session.expiresInSeconds * 1000,
    });
    // Browser sessions never see the token: keeping it httpOnly means an XSS
    // cannot exfiltrate a reusable bearer credential.
    return responseMode === 'token'
      ? session
      : { user: session.user, expiresInSeconds: session.expiresInSeconds };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Clear the session cookie' })
  logout(@Res({ passthrough: true }) res: Response): { loggedOut: true } {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { loggedOut: true };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current user' })
  me(@CurrentUser() user: AuthUser): Promise<SessionResult['user']> {
    return this.auth.me(user.id);
  }
}
