import {
  AppError,
  AuthorizationError,
  NotFoundError,
  RateLimitError,
  ValidationError,
  WorkflowTransitionError,
} from '@aab/shared-types';
import type { ArgumentsHost } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AllExceptionsFilter } from './all-exceptions.filter';

function run(exception: unknown): { status: number; body: Record<string, unknown> } {
  const captured = { status: 0, body: {} as Record<string, unknown> };
  const res = {
    headersSent: false,
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      captured.body = body;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ id: 'req-1' }) }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return captured;
}

describe('AllExceptionsFilter', () => {
  it.each([
    [new ValidationError('bad'), 400, 'VALIDATION_ERROR'],
    [new AuthorizationError(), 403, 'AUTHORIZATION_ERROR'],
    [new NotFoundError(), 404, 'NOT_FOUND'],
    [new WorkflowTransitionError('no'), 409, 'WORKFLOW_TRANSITION_ERROR'],
    [new RateLimitError('slow down'), 429, 'RATE_LIMITED'],
    [new NotFoundException(), 404, 'NOT_FOUND'],
  ])('maps %s to %i', (error, status, code) => {
    const out = run(error);
    expect(out.status).toBe(status);
    expect(out.body).toMatchObject({
      success: false,
      error: { code },
      meta: { requestId: 'req-1' },
    });
  });

  it('hides internal error details', () => {
    const out = run(new AppError('INTERNAL_ERROR', 'connection string postgres://u:secret@h'));
    expect(out.status).toBe(500);
    expect(JSON.stringify(out.body)).not.toContain('secret');
  });

  it('treats unknown throwables as generic 500s', () => {
    const out = run(new TypeError('cannot read x of undefined'));
    expect(out.status).toBe(500);
    expect(out.body).toMatchObject({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  });
});
