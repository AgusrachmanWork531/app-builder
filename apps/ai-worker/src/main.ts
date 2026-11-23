import { hostname } from 'node:os';
import { createPrismaClient } from '@aab/database';
import { BUILD_QUEUE_NAME } from '@aab/job-contracts';
import { createLogger } from '@aab/logger';
import { loadWorkspaceDotenv, parseEnv, workerEnvSchema } from '@aab/shared-config';
import { Redis } from 'ioredis';
import { createBuildWorker } from './execution/create-worker';

const SHUTDOWN_GRACE_MS = 30_000;

async function main(): Promise<void> {
  loadWorkspaceDotenv();
  const env = parseEnv(workerEnvSchema); // fail fast on invalid configuration
  const workerId = env.WORKER_ID ?? `${hostname()}-${process.pid}`;
  const logger = createLogger({ name: 'ai-worker', level: env.LOG_LEVEL, base: { workerId } });

  const prisma = createPrismaClient({
    databaseUrl: env.DATABASE_URL,
    maxConnections: env.WORKER_CONCURRENCY + 2,
  });
  await prisma.$queryRaw`SELECT 1`;

  // BullMQ requires maxRetriesPerRequest: null on its blocking connection.
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  connection.on('error', (error) => logger.error({ err: error }, 'redis connection error'));

  const worker = createBuildWorker({
    env,
    prisma,
    connection,
    logger,
    workerId,
    queueName: BUILD_QUEUE_NAME,
  });
  worker.on('failed', (job, error) =>
    logger.warn({ queueJobId: job?.id, errorMessage: error.message }, 'queue job failed'),
  );
  worker.on('error', (error) => logger.error({ err: error }, 'worker error'));
  await worker.waitUntilReady();
  logger.info(
    { queue: BUILD_QUEUE_NAME, concurrency: env.WORKER_CONCURRENCY, runtime: env.AGENT_RUNTIME },
    'worker ready',
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down: waiting for active jobs');
    const force = setTimeout(() => {
      logger.error('graceful shutdown timed out; exiting');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    force.unref();
    try {
      await worker.close();
      await connection.quit();
      await prisma.$disconnect();
      logger.info('shutdown complete');
    } catch (error) {
      logger.error({ err: error }, 'error during shutdown');
      process.exitCode = 1;
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
