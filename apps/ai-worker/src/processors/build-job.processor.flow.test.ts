import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@aab/database';
import { createLogger } from '@aab/logger';
import { ExternalProviderError, ValidationError } from '@aab/shared-types';
import { type Job, UnrecoverableError } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createBuildJobProcessor } from './build-job.processor';

const { appendEvent, transitionBuild } = vi.hoisted(() => ({
  appendEvent: vi.fn(),
  transitionBuild: vi.fn(),
}));
vi.mock('@aab/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@aab/database')>()),
  appendEvent,
  transitionBuild,
}));

const payload = {
  schemaVersion: 1,
  buildJobId: randomUUID(),
  projectId: randomUUID(),
  attempt: 1,
  correlationId: 'c1',
  enqueuedAt: new Date().toISOString(),
};

function job(attemptsMade: number, attempts = 3): Job {
  return { id: 'q1', data: payload, attemptsMade, opts: { attempts } } as unknown as Job;
}

function processorFailingWith(error: unknown) {
  return createBuildJobProcessor({
    prisma: {} as PrismaClient,
    logger: createLogger({ name: 't', level: 'fatal' }),
    workflow: { run: () => Promise.reject(error) },
  });
}

beforeEach(() => {
  appendEvent.mockReset().mockResolvedValue(undefined);
  transitionBuild.mockReset().mockResolvedValue({ applied: true });
});

describe('build job processor failure handling', () => {
  it('schedules a queue retry for retryable errors while attempts remain', async () => {
    const error = new ExternalProviderError('upstream 503');
    await expect(processorFailingWith(error)(job(0))).rejects.toBe(error);
    expect(appendEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'RETRY_SCHEDULED', buildJobId: payload.buildJobId }),
    );
    expect(transitionBuild).not.toHaveBeenCalled();
  });

  it('persists FAILED and stops retrying on the last attempt', async () => {
    const run = processorFailingWith(new ExternalProviderError('upstream 503'));
    await expect(run(job(2))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(transitionBuild).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        to: 'FAILED',
        attempt: 1,
        error: expect.objectContaining({ code: 'EXTERNAL_PROVIDER_ERROR' }),
      }),
    );
  });

  it('fails immediately for non-retryable errors', async () => {
    await expect(
      processorFailingWith(new ValidationError('bad spec'))(job(0)),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(appendEvent).not.toHaveBeenCalled();
    expect(transitionBuild).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        to: 'FAILED',
        error: expect.objectContaining({ code: 'VALIDATION_ERROR' }),
      }),
    );
  });

  it('retries transient connectivity errors instead of failing the build', async () => {
    const error = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
      name: 'Error',
    });
    await expect(processorFailingWith(error)(job(0))).rejects.toMatchObject({
      code: 'QUEUE_PROCESSING_ERROR',
    });
    expect(transitionBuild).not.toHaveBeenCalled();
  });

  it('rejects an invalid payload without touching the database', async () => {
    const processor = processorFailingWith(new Error('unused'));
    await expect(
      processor({ id: 'q', data: { nope: true }, attemptsMade: 0, opts: {} } as unknown as Job),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(transitionBuild).not.toHaveBeenCalled();
  });
});
