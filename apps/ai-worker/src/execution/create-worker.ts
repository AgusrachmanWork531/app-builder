import type { PrismaClient } from '@aab/database';
import { LogMetrics, type Logger } from '@aab/logger';
import { MockSandboxProvider } from '@aab/sandbox-adapters';
import type { WorkerEnv } from '@aab/shared-config';
import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { MockAgentRuntime } from '../agents/mock-agent-runtime';
import { createBuildJobProcessor } from '../processors/build-job.processor';
import { BuildWorkflow } from '../workflows/build-workflow';

export interface CreateBuildWorkerOptions {
  env: Pick<
    WorkerEnv,
    | 'AGENT_RUNTIME'
    | 'SANDBOX_PROVIDER'
    | 'ARTIFACT_STORAGE_PATH'
    | 'MOCK_STEP_DELAY_MS'
    | 'BUILD_TIMEOUT_SECONDS'
    | 'WORKER_CONCURRENCY'
    | 'QUEUE_PREFIX'
    | 'MAX_REPAIR_ATTEMPTS'
    | 'ARTIFACT_RETENTION_DAYS'
  >;
  prisma: PrismaClient;
  connection: Redis;
  logger: Logger;
  workerId: string;
  queueName: string;
}

/**
 * Wire runtime, sandbox, workflow and processor into a BullMQ worker. Only the
 * mock runtime and mock sandbox exist; the env schema rejects anything else.
 */
export function createBuildWorker(options: CreateBuildWorkerOptions): Worker {
  const { env, prisma, logger } = options;
  const runtime = new MockAgentRuntime(env.MOCK_STEP_DELAY_MS);
  const sandbox = new MockSandboxProvider(env.ARTIFACT_STORAGE_PATH);
  const workflow = new BuildWorkflow({
    prisma,
    runtime,
    sandbox,
    logger,
    workerId: options.workerId,
    buildTimeoutSeconds: env.BUILD_TIMEOUT_SECONDS,
    maxRepairAttempts: env.MAX_REPAIR_ATTEMPTS,
    artifactRetentionDays: env.ARTIFACT_RETENTION_DAYS,
  });
  const metrics = new LogMetrics(logger.child({ component: 'metrics' }));
  return new Worker(
    options.queueName,
    createBuildJobProcessor({ prisma, workflow, logger, metrics }),
    {
      connection: options.connection,
      prefix: env.QUEUE_PREFIX,
      concurrency: env.WORKER_CONCURRENCY,
    },
  );
}
