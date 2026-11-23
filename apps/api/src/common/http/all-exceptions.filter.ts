import { AppError, type ApiErrorBody, type ErrorCode } from '@aab/shared-types';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { type AppRequest, requestIdOf } from './request';

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  VALIDATION_ERROR: HttpStatus.BAD_REQUEST,
  AUTHENTICATION_ERROR: HttpStatus.UNAUTHORIZED,
  AUTHORIZATION_ERROR: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  WORKFLOW_TRANSITION_ERROR: HttpStatus.CONFLICT,
  APPROVAL_REQUIRED: HttpStatus.CONFLICT,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  RESOURCE_LIMIT_EXCEEDED: HttpStatus.PAYLOAD_TOO_LARGE,
  EXTERNAL_PROVIDER_ERROR: HttpStatus.BAD_GATEWAY,
  TIMEOUT: HttpStatus.GATEWAY_TIMEOUT,
};

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: 'VALIDATION_ERROR',
  401: 'AUTHENTICATION_ERROR',
  403: 'AUTHORIZATION_ERROR',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'RESOURCE_LIMIT_EXCEEDED',
  429: 'RATE_LIMITED',
};

/**
 * Single error format for every endpoint. Unknown errors become a generic 500
 * (details are logged server-side, never returned).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpError');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<AppRequest>();
    const { status, body } = this.toBody(exception, requestIdOf(req));
    if (status >= 500) {
      this.logger.error({ err: exception, requestId: body.meta.requestId }, 'unhandled error');
    }
    if (!res.headersSent) res.status(status).json(body);
  }

  private toBody(exception: unknown, requestId: string): { status: number; body: ApiErrorBody } {
    if (exception instanceof AppError) {
      const status = STATUS_BY_CODE[exception.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
      const internal = status >= 500 && exception.code === 'INTERNAL_ERROR';
      return {
        status,
        body: {
          success: false,
          error: {
            code: exception.code,
            message: internal ? 'Internal server error' : exception.message,
            retryable: exception.retryable,
            ...(exception.details !== undefined && !internal ? { details: exception.details } : {}),
          },
          meta: { requestId },
        },
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: unknown }).message ?? exception.message);
      return {
        status,
        body: {
          success: false,
          error: {
            code: CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR'),
            message: Array.isArray(message) ? message.join('; ') : String(message),
            retryable: status === 503 || status === 429,
            ...(typeof response === 'object' && status === 503 ? { details: response } : {}),
          },
          meta: { requestId },
        },
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error', retryable: false },
        meta: { requestId },
      },
    };
  }
}
