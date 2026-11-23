import type { ApiSuccess } from '@aab/shared-types';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Observable, map } from 'rxjs';
import { Paginated } from './paginated';
import { type AppRequest, requestIdOf } from './request';

const RAW_RESPONSE = 'aab:raw-response';
/** Opt a handler out of the envelope (health probes, SSE streams). */
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);

/** Wraps handler results as { success: true, data, meta: { requestId, pagination? } }. */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (raw || context.getType() !== 'http') return next.handle();
    const requestId = requestIdOf(context.switchToHttp().getRequest<AppRequest>());

    return next.handle().pipe(
      map((value): ApiSuccess<unknown> => {
        if (value instanceof Paginated) {
          return {
            success: true,
            data: value.items,
            meta: { requestId, pagination: value.pagination },
          };
        }
        return { success: true, data: value ?? null, meta: { requestId } };
      }),
    );
  }
}
