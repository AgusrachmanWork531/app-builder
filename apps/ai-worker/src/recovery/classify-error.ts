import { Prisma } from '@aab/database';
import { type AppError, QueueProcessingError, toAppError } from '@aab/shared-types';

/**
 * Prisma error codes that indicate a transient infrastructure condition
 * (unreachable/timeout/pool exhaustion/serialization conflict), not a bug.
 */
const TRANSIENT_PRISMA_CODES = new Set([
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2024',
  'P2028',
  'P2034',
]);

const TRANSIENT_NETWORK_PATTERN =
  /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|Connection is closed|Connection terminated|MaxRetriesPerRequest/i;

/**
 * Classify a thrown value for retry decisions. Known AppErrors keep their own
 * classification; database/Redis connectivity problems become retryable so a
 * blip uses the bounded BullMQ retry budget instead of failing the build.
 * Everything else is non-retryable (a programming bug must not retry-storm).
 */
export function classifyError(error: unknown): AppError {
  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      TRANSIENT_PRISMA_CODES.has(error.code))
  ) {
    return new QueueProcessingError('Database temporarily unavailable', { cause: error });
  }
  if (
    error instanceof Error &&
    !('code' in error && typeof error.code === 'string' && error.code.startsWith('P'))
  ) {
    if (
      TRANSIENT_NETWORK_PATTERN.test(error.message) ||
      TRANSIENT_NETWORK_PATTERN.test(error.name)
    ) {
      return new QueueProcessingError('Infrastructure temporarily unavailable', { cause: error });
    }
  }
  return toAppError(error);
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
