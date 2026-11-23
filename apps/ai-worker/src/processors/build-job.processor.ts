import { CANCELLABLE_STATUSES } from '@aab/agent-core';
import { type PrismaClient, appendEvent, transitionBuild } from '@aab/database';
import { type BuildJobPayload, buildJobPayloadSchema } from '@aab/job-contracts';
import { type Logger, withContext } from '@aab/logger';
import { type AppError, ValidationError } from '@aab/shared-types';
import { type Job, UnrecoverableError } from 'bullmq';
import { classifyError } from '../recovery/classify-error';
import type { BuildWorkflow, WorkflowOutcome } from '../workflows/build-workflow';

export interface BuildJobProcessorDeps {
  prisma: PrismaClient;
  workflow: Pick<BuildWorkflow, 'run'>;
  logger: Logger;
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
  const appError = classifyError(error);
  return appError.retryable
    ? appError
    : new UnrecoverableError(`${appError.code}: ${appError.message}`);
}

/** Message safe to persist and show to users (internal errors are not echoed). */
export function publicMessage(error: AppError): string {
  return error.code === 'INTERNAL_ERROR' ? 'Internal worker error' : error.message;
}

export function remainingQueueAttempts(job: Pick<Job, 'opts' | 'attemptsMade'>): number {
  return Math.max(0, (job.opts.attempts ?? 1) - (job.attemptsMade + 1));
}

export function createBuildJobProcessor(deps: BuildJobProcessorDeps) {
  return async function processBuildJob(job: Job): Promise<WorkflowOutcome> {
    let payload: BuildJobPayload;
    try {
      payload = validatePayload(job.data);
    } catch (error) {
      deps.logger.error({ queueJobId: job.id }, 'rejected invalid build job payload');
      throw toQueueError(error);
    }
    const logger = withContext(deps.logger, {
      buildId: payload.buildJobId,
      correlationId: payload.correlationId,
    });

    try {
      return await deps.workflow.run(payload);
    } catch (error) {
      const appError = classifyError(error);
      const remaining = remainingQueueAttempts(job);
      logger.warn(
        { errorCode: appError.code, retryable: appError.retryable, remaining, err: error },
        'build step failed',
      );

      if (appError.retryable && remaining > 0) {
        await appendEvent(deps.prisma, {
          buildJobId: payload.buildJobId,
          attempt: payload.attempt,
          type: 'RETRY_SCHEDULED',
          message: `${publicMessage(appError)} (queue retries left: ${remaining})`,
          metadata: { errorCode: appError.code, queueAttempt: job.attemptsMade + 1 },
        });
        throw appError;
      }

      await transitionBuild(deps.prisma, {
        buildJobId: payload.buildJobId,
        to: 'FAILED',
        attempt: payload.attempt,
        expectedFrom: [...CANCELLABLE_STATUSES],
        message: `Build failed: ${publicMessage(appError)}`,
        error: {
          code: appError.code,
          message: publicMessage(appError),
          details: appError.code === 'INTERNAL_ERROR' ? {} : safeDetails(appError.details),
        },
      });
      throw new UnrecoverableError(`${appError.code}: ${publicMessage(appError)}`);
    }
  };
}

function safeDetails(details: unknown): { [key: string]: string | number | boolean | string[] } {
  if (typeof details !== 'object' || details === null) return {};
  const out: { [key: string]: string | number | boolean | string[] } = {};
  for (const [key, value] of Object.entries(details)) {
    if (['string', 'number', 'boolean'].includes(typeof value)) {
      out[key] = value as string | number | boolean;
    } else if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      out[key] = value as string[];
    }
  }
  return out;
}
