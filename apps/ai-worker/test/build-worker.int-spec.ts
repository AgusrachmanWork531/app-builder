import { randomUUID } from 'node:crypto';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppSpecification } from '@aab/agent-core';
import { type PrismaClient, createPrismaClient } from '@aab/database';
import { BUILD_JOB_NAME, type BuildJobPayload, buildQueueJobId } from '@aab/job-contracts';
import { createLogger } from '@aab/logger';
import { loadWorkspaceDotenv } from '@aab/shared-config';
import { type Job, Queue, QueueEvents, type Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBuildWorker } from '../src/execution/create-worker';

const spec: AppSpecification = {
  schemaVersion: 1,
  appName: 'Task Manager',
  summary: 'Track tasks',
  entities: [{ name: 'Task', fields: [{ name: 'title', type: 'string', required: true }] }],
  pages: ['TaskList'],
  features: ['Create tasks'],
  analysis: { analyzer: 'mock', isMock: true, matchedTemplate: 'task-manager', warnings: [] },
};

let prisma: PrismaClient;
let connection: Redis;
let queue: Queue;
let events: QueueEvents;
let worker: Worker;
let storage: string;
const queueName = 'build-jobs';
const queuePrefix = `aab-test-${randomUUID().slice(0, 8)}`;
const users: string[] = [];

async function seedBuild(
  specification: object = spec,
  options: object = {},
): Promise<{ id: string; projectId: string }> {
  const user = await prisma.user.create({
    data: { email: `worker-${randomUUID()}@test.local`, passwordHash: 'x' },
  });
  users.push(user.id);
  const project = await prisma.project.create({ data: { ownerId: user.id, name: 'worker test' } });
  const requirement = await prisma.projectRequirement.create({
    data: {
      projectId: project.id,
      revision: 1,
      rawPrompt: 'todo app',
      normalizedPrompt: 'todo app',
      specification,
      analyzer: 'mock',
      createdById: user.id,
    },
  });
  const build = await prisma.buildJob.create({
    data: {
      projectId: project.id,
      requirementId: requirement.id,
      requestedById: user.id,
      maxAttempts: 3,
      status: 'QUEUED',
      options,
    },
  });
  return { id: build.id, projectId: project.id };
}

async function statusTrail(buildJobId: string): Promise<(string | null)[]> {
  const rows = await prisma.buildJobEvent.findMany({
    where: { buildJobId, type: 'STATUS_CHANGED' },
    orderBy: { sequence: 'asc' },
  });
  return rows.map((e) => e.toStatus);
}

async function enqueue(build: { id: string; projectId: string }): Promise<Job> {
  const payload: BuildJobPayload = {
    schemaVersion: 1,
    buildJobId: build.id,
    projectId: build.projectId,
    attempt: 1,
    correlationId: 'test',
    enqueuedAt: new Date().toISOString(),
  };
  return queue.add(BUILD_JOB_NAME, payload, {
    jobId: buildQueueJobId(build.id, 1),
    attempts: 2,
    backoff: { type: 'fixed', delay: 100 },
  });
}

async function settle(job: Job): Promise<void> {
  await job.waitUntilFinished(events, 30_000).catch(() => undefined);
}

beforeAll(async () => {
  loadWorkspaceDotenv();
  storage = await mkdtemp(join(tmpdir(), 'aab-worker-it-'));
  prisma = createPrismaClient({ databaseUrl: process.env.DATABASE_URL ?? '' });
  connection = new Redis(process.env.REDIS_URL ?? '', { maxRetriesPerRequest: null });
  queue = new Queue(queueName, { connection, prefix: queuePrefix });
  events = new QueueEvents(queueName, { connection: connection.duplicate(), prefix: queuePrefix });
  await events.waitUntilReady();
  worker = createBuildWorker({
    env: {
      AGENT_RUNTIME: 'mock',
      SANDBOX_PROVIDER: 'mock',
      ARTIFACT_STORAGE_PATH: storage,
      MOCK_STEP_DELAY_MS: 0,
      BUILD_TIMEOUT_SECONDS: 30,
      WORKER_CONCURRENCY: 2,
      QUEUE_PREFIX: queuePrefix,
      MAX_REPAIR_ATTEMPTS: 2,
      ARTIFACT_RETENTION_DAYS: 30,
    },
    prisma,
    connection: connection.duplicate(),
    logger: createLogger({ name: 'worker-it', level: 'fatal' }),
    workerId: 'it-worker',
    queueName,
  });
  await worker.waitUntilReady();
});

afterAll(async () => {
  await worker?.close();
  await events?.close();
  await queue?.obliterate({ force: true });
  await queue?.close();
  await connection?.quit();
  await prisma?.user.deleteMany({ where: { id: { in: users } } });
  await prisma?.$disconnect();
  await rm(storage, { recursive: true, force: true });
});

describe('build worker (integration: BullMQ + PostgreSQL)', () => {
  it('runs a queued build to COMPLETED with persisted events, plan and mock artifacts', async () => {
    const build = await seedBuild();
    await settle(await enqueue(build));

    const row = await prisma.buildJob.findUniqueOrThrow({ where: { id: build.id } });
    expect(row.status).toBe('COMPLETED');
    expect(row.workerId).toBe('it-worker');

    const statusEvents = await prisma.buildJobEvent.findMany({
      where: { buildJobId: build.id, type: 'STATUS_CHANGED' },
      orderBy: { sequence: 'asc' },
    });
    expect(statusEvents.map((e) => e.toStatus)).toEqual([
      'PLANNING',
      'GENERATING',
      'TESTING',
      'COMPLETED',
    ]);

    const plan = await prisma.executionPlan.findFirstOrThrow({
      where: { buildJobId: build.id },
      include: { tasks: true },
    });
    expect(plan.tasks.every((t) => t.status === 'COMPLETED')).toBe(true);

    const artifacts = await prisma.projectArtifact.findMany({ where: { buildJobId: build.id } });
    expect(artifacts.length).toBe(5);
    expect(artifacts.every((a) => a.isMock)).toBe(true);
    // Retention: artifacts expire ~30 days out (cleaned up by the API).
    const days = (artifacts[0]!.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThanOrEqual(30);
    await access(join(storage, artifacts[0]!.storageKey));

    expect(await prisma.workflowCheckpoint.count({ where: { buildJobId: build.id } })).toBe(3);
  });

  it('treats a duplicate delivery of a completed build as a no-op', async () => {
    const build = await seedBuild();
    await settle(await enqueue(build));
    const before = await prisma.buildJobEvent.count({ where: { buildJobId: build.id } });

    // Simulate a redelivery with a fresh queue job for the same attempt.
    const dup = await queue.add(
      BUILD_JOB_NAME,
      (await queue.getJob(buildQueueJobId(build.id, 1)))!.data,
      {
        jobId: `${buildQueueJobId(build.id, 1)}_dup`,
      },
    );
    await settle(dup);
    expect(await dup.getState()).toBe('completed');
    expect(await prisma.buildJobEvent.count({ where: { buildJobId: build.id } })).toBe(before);
  });

  it('resumes a build redelivered mid-GENERATING and restores the missing PLAN_CREATED event', async () => {
    const build = await seedBuild();
    // Simulate a crash after the plan insert but before its event, while GENERATING.
    await prisma.buildJob.update({ where: { id: build.id }, data: { status: 'GENERATING' } });
    await prisma.executionPlan.create({
      data: {
        buildJobId: build.id,
        attempt: 1,
        summary: '[MOCK] pre-crash plan',
        producer: 'mock-agent',
        tasks: {
          create: ['scaffold', 'data-model', 'api', 'ui', 'validation'].map((key, position) => ({
            key,
            position,
            title: key,
          })),
        },
      },
    });
    await settle(await enqueue(build));

    const row = await prisma.buildJob.findUniqueOrThrow({ where: { id: build.id } });
    expect(row.status).toBe('COMPLETED');
    const events = await prisma.buildJobEvent.findMany({
      where: { buildJobId: build.id },
      orderBy: { sequence: 'asc' },
    });
    expect(events.map((e) => e.type)).toContain('PLAN_CREATED');
    expect(events.filter((e) => e.type === 'STATUS_CHANGED').map((e) => e.toStatus)).toEqual([
      'TESTING',
      'COMPLETED',
    ]);
    expect(await prisma.executionPlan.count({ where: { buildJobId: build.id } })).toBe(1);
  });

  it('tolerates two concurrent deliveries of the same attempt', async () => {
    const build = await seedBuild();
    const first = await enqueue(build);
    const second = await queue.add(BUILD_JOB_NAME, first.data, {
      jobId: `${buildQueueJobId(build.id, 1)}_concurrent`,
    });
    await Promise.all([settle(first), settle(second)]);

    const row = await prisma.buildJob.findUniqueOrThrow({ where: { id: build.id } });
    expect(row.status).toBe('COMPLETED');
    expect(await prisma.executionPlan.count({ where: { buildJobId: build.id } })).toBe(1);
    const statusEvents = await prisma.buildJobEvent.findMany({
      where: { buildJobId: build.id, type: 'STATUS_CHANGED' },
    });
    // Each transition is recorded exactly once despite two workers.
    expect(statusEvents.map((e) => e.toStatus).sort()).toEqual(
      ['COMPLETED', 'GENERATING', 'PLANNING', 'TESTING'].sort(),
    );
  });

  it('repairs once and completes when validation fails only the first time', async () => {
    const build = await seedBuild(spec, { simulateFailure: 'validation-once' });
    await settle(await enqueue(build));
    const row = await prisma.buildJob.findUniqueOrThrow({ where: { id: build.id } });
    expect(row).toMatchObject({ status: 'COMPLETED', repairAttempts: 1 });
    expect(await statusTrail(build.id)).toEqual([
      'PLANNING',
      'GENERATING',
      'TESTING',
      'REPAIRING',
      'TESTING',
      'COMPLETED',
    ]);
  });

  it('fails after MAX_REPAIR_ATTEMPTS bounded repair rounds', async () => {
    const build = await seedBuild(spec, { simulateFailure: 'validation-always' });
    const job = await enqueue(build);
    await settle(job);
    const row = await prisma.buildJob.findUniqueOrThrow({ where: { id: build.id } });
    expect(row).toMatchObject({ status: 'FAILED', repairAttempts: 2, errorCode: 'BUILD_FAILURE' });
    expect(await statusTrail(build.id)).toEqual([
      'PLANNING',
      'GENERATING',
      'TESTING',
      'REPAIRING',
      'TESTING',
      'REPAIRING',
      'TESTING',
      'FAILED',
    ]);
    expect((await queue.getJob(job.id!))?.attemptsMade).toBe(1);
  });

  it('resumes a build redelivered mid-REPAIRING without skipping a repair round', async () => {
    const build = await seedBuild(spec, { simulateFailure: 'validation-always' });
    // Crash state: TESTING → REPAIRING (round 1) was committed atomically with repairAttempts=1.
    await prisma.buildJob.update({
      where: { id: build.id },
      data: { status: 'REPAIRING', repairAttempts: 1 },
    });
    await settle(await enqueue(build));
    const row = await prisma.buildJob.findUniqueOrThrow({ where: { id: build.id } });
    expect(row).toMatchObject({ status: 'FAILED', repairAttempts: 2 });
    // Round 1 resumed, round 2 performed, then the limit (2) is reached.
    expect(await statusTrail(build.id)).toEqual(['TESTING', 'REPAIRING', 'TESTING', 'FAILED']);
    expect(
      await prisma.workflowCheckpoint.count({
        where: { buildJobId: build.id, step: { startsWith: 'REPAIRING-' } },
      }),
    ).toBe(2);
  });

  it('honours a cancellation requested before pickup', async () => {
    const build = await seedBuild();
    await prisma.buildJob.update({
      where: { id: build.id },
      data: { cancelRequestedAt: new Date() },
    });
    await settle(await enqueue(build));
    const row = await prisma.buildJob.findUniqueOrThrow({ where: { id: build.id } });
    expect(row.status).toBe('CANCELLED');
    expect(await prisma.executionPlan.count({ where: { buildJobId: build.id } })).toBe(0);
  });

  it('marks the build FAILED (non-retryable) when the stored specification is invalid', async () => {
    const build = await seedBuild({ not: 'a spec' });
    const job = await enqueue(build);
    await settle(job);

    const row = await prisma.buildJob.findUniqueOrThrow({ where: { id: build.id } });
    expect(row.status).toBe('FAILED');
    expect(row.errorCode).toBe('VALIDATION_ERROR');
    // Non-retryable: BullMQ must not have retried it.
    expect((await queue.getJob(job.id!))?.attemptsMade).toBe(1);
  });
});

describe('cooperative cancellation (integration: slow mock steps)', () => {
  it('aborts an in-flight step and persists CANCELLED', async () => {
    const slowPrefix = `aab-test-slow-${randomUUID().slice(0, 8)}`;
    const slowQueue = new Queue(queueName, { connection, prefix: slowPrefix });
    const slowEvents = new QueueEvents(queueName, {
      connection: connection.duplicate(),
      prefix: slowPrefix,
    });
    await slowEvents.waitUntilReady();
    const slowWorker = createBuildWorker({
      env: {
        AGENT_RUNTIME: 'mock',
        SANDBOX_PROVIDER: 'mock',
        ARTIFACT_STORAGE_PATH: storage,
        MOCK_STEP_DELAY_MS: 3000,
        BUILD_TIMEOUT_SECONDS: 30,
        WORKER_CONCURRENCY: 1,
        QUEUE_PREFIX: slowPrefix,
        MAX_REPAIR_ATTEMPTS: 2,
        ARTIFACT_RETENTION_DAYS: 30,
      },
      prisma,
      connection: connection.duplicate(),
      logger: createLogger({ name: 'worker-it-slow', level: 'fatal' }),
      workerId: 'it-worker-slow',
      queueName,
    });
    try {
      await slowWorker.waitUntilReady();
      const build = await seedBuild();
      const job = await slowQueue.add(
        BUILD_JOB_NAME,
        {
          schemaVersion: 1,
          buildJobId: build.id,
          projectId: build.projectId,
          attempt: 1,
          correlationId: 'cancel-test',
          enqueuedAt: new Date().toISOString(),
        },
        { jobId: buildQueueJobId(build.id, 1) },
      );
      // Wait until the worker is inside PLANNING (a 3s mock step), then request cancel.
      for (let i = 0; i < 50; i++) {
        const row = await prisma.buildJob.findUniqueOrThrow({ where: { id: build.id } });
        if (row.status === 'PLANNING') break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const requestedAt = Date.now();
      await prisma.buildJob.update({
        where: { id: build.id },
        data: { cancelRequestedAt: new Date() },
      });
      await job.waitUntilFinished(slowEvents, 15_000);

      const row = await prisma.buildJob.findUniqueOrThrow({ where: { id: build.id } });
      expect(row.status).toBe('CANCELLED');
      // Aborted mid-step (well before the 3s step would have finished on its own).
      expect(Date.now() - requestedAt).toBeLessThan(2500);
      expect(await prisma.executionPlan.count({ where: { buildJobId: build.id } })).toBe(0);
    } finally {
      await slowWorker.close();
      await slowEvents.close();
      await slowQueue.obliterate({ force: true });
      await slowQueue.close();
    }
  });
});
