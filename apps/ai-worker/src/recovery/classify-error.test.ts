import { Prisma } from '@aab/database';
import { ValidationError } from '@aab/shared-types';
import { describe, expect, it } from 'vitest';
import { classifyError, isUniqueViolation } from './classify-error';

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('db error', { code, clientVersion: 'test' });
}

describe('classifyError', () => {
  it.each(['P1001', 'P2024', 'P2034'])('treats Prisma %s as retryable', (code) => {
    expect(classifyError(prismaError(code))).toMatchObject({
      code: 'QUEUE_PROCESSING_ERROR',
      retryable: true,
    });
  });

  it('treats Redis/network connectivity errors as retryable', () => {
    expect(classifyError(new Error('Connection is closed.')).retryable).toBe(true);
    expect(classifyError(new Error('read ECONNRESET')).retryable).toBe(true);
  });

  it('keeps non-transient Prisma errors non-retryable', () => {
    expect(classifyError(prismaError('P2002')).retryable).toBe(false);
  });

  it('keeps AppError classification and treats bugs as non-retryable', () => {
    expect(classifyError(new ValidationError('x')).code).toBe('VALIDATION_ERROR');
    expect(classifyError(new TypeError('undefined is not a function')).retryable).toBe(false);
  });

  it('detects unique violations', () => {
    expect(isUniqueViolation(prismaError('P2002'))).toBe(true);
    expect(isUniqueViolation(prismaError('P2034'))).toBe(false);
  });
});
