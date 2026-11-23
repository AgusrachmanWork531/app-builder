import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import { AuthenticationError } from '@aab/shared-types';
import type { AppRequest, AuthUser } from '../http/request';

export const IS_PUBLIC = 'aab:is-public';
/** Mark a route as not requiring authentication (health, login). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Inject the authenticated user (guaranteed present on non-public routes). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const user = ctx.switchToHttp().getRequest<AppRequest>().user;
    if (!user) throw new AuthenticationError();
    return user;
  },
);
