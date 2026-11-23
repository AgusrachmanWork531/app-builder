import type { PrismaClient } from '@aab/database';
import { type BuildJobPayload, buildJobPayloadSchema } from '@aab/job-contracts';
import type { Logger } from '@aab/logger';
import { AppError, NotFoundError, ValidationError, toAppError } from '@aab/shared-types';
import { type Job, UnrecoverableError } from 'bullmq';

export interface BuildJobProcessorDeps {
  prisma: PrismaClient;
  logger: Logger;
  workerId: string;
}

/** Validate an untrusted queue payload against the versioned contract. */
export function validatePayload(data: unknown): BuildJobPayload {
  const result = buildJobPayloadSchema.safeParse(data);
  if (!result.success) {
    throw new ValidationError('Invalid build job payload', { details: result.error.issues });
  }
  return result.data;
}

/**
 * Map an AppError to BullMQ semantics: non-retryable failures become
 * UnrecoverableError so BullMQ does not burn its retry budget on them.
 */
export function toQueueError(error: unknown): Error {
  const appError = toAppError(error);
  return appError.retryable
    ? appError
    : new UnrecoverableError(`${appError.code}: ${appError.message}`);
}

export function createBuildJobProcessor(deps: BuildJobProcessorDeps) {
  return async function processBuildJob(job: Job): Promise<{ buildJobId: string }> {
    try {
      const payload = validatePayload(job.data);
      const build = await deps.prisma.buildJob.findUnique({
        where: { id: payload.buildJobId },
        select: { id: true, status: true, attempt: true },
      });
      if (!build) throw new NotFoundError(`Build job ${payload.buildJobId} not found`);

      deps.logger.info(
        { buildId: build.id, status: build.status, workerId: deps.workerId },
        'build job received',
      );
      // Workflow execution (state machine + mock agent runtime) is wired in slice S1.
      throw new AppError('INTERNAL_ERROR', 'Workflow execution is not implemented yet');
    } catch (error) {
      throw toQueueError(error);
    }
  };
}
