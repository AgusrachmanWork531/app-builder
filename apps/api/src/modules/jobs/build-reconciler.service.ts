import { ACTIVE_STATUSES } from '@aab/agent-core';
import { transitionBuild } from '@aab/database';
import { buildQueueJobId } from '@aab/job-contracts';
import type { ApiEnv } from '@aab/shared-config';
import type { BuildStatus } from '@aab/shared-types';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { API_ENV } from '../../config/api-env.token';
import { PrismaService } from '../../infrastructure/prisma.service';
import { BuildQueue } from './build-queue';

/** Queue states in which BullMQ itself will (re)deliver the job. */
const LIVE_JOB_STATES = new Set([
  'active',
  'waiting',
  'delayed',
  'prioritized',
  'waiting-children',
]);
const BATCH = 50;
const RECONCILED_STATUSES: BuildStatus[] = ['QUEUED', ...ACTIVE_STATUSES];

/**
 * Recovers builds whose worker disappeared. A build that is "running" in
 * PostgreSQL but has no recent heartbeat is checked against BullMQ:
 *  - queue job still live → leave it (BullMQ stall detection redelivers it and
 *    the workflow resumes from persisted state);
 *  - queue job gone/failed → persist FAILED (or CANCELLED if cancellation was
 *    requested) so the user can retry instead of waiting forever.
 */
@Injectable()
export class BuildReconciler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BuildReconciler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly buildQueue: BuildQueue,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.reconcile(), this.env.RECONCILE_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async reconcile(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const cutoff = new Date(Date.now() - this.env.STALE_BUILD_SECONDS * 1000);
      // QUEUED builds have no heartbeat yet; they are stale when their queue job
      // is no longer live (e.g. lost from Redis) — otherwise they wait in line.
      const stale = await this.prisma.client.buildJob.findMany({
        where: {
          status: { in: RECONCILED_STATUSES },
          OR: [
            { lastHeartbeatAt: { lt: cutoff } },
            { lastHeartbeatAt: null, updatedAt: { lt: cutoff } },
          ],
        },
        select: { id: true, attempt: true, status: true, cancelRequestedAt: true },
        take: BATCH,
      });
      let recovered = 0;
      for (const build of stale) {
        const job = await this.buildQueue.queue.getJob(buildQueueJobId(build.id, build.attempt));
        const state = job ? await job.getState() : 'missing';
        if (LIVE_JOB_STATES.has(state)) continue;

        const result = await transitionBuild(this.prisma.client, {
          buildJobId: build.id,
          attempt: build.attempt,
          expectedFrom: RECONCILED_STATUSES,
          ...(build.cancelRequestedAt
            ? { to: 'CANCELLED' as const, message: 'Build cancelled (worker no longer running)' }
            : {
                to: 'FAILED' as const,
                message: 'Worker stopped responding; retry the build',
                error: {
                  code: 'QUEUE_PROCESSING_ERROR',
                  message: 'Worker stopped responding; retry the build',
                  details: { queueState: state },
                },
              }),
        });
        if (result.applied) {
          recovered++;
          this.logger.warn({ buildId: build.id, queueState: state }, 'reconciled stale build');
        }
      }
      return recovered;
    } catch (error) {
      this.logger.error({ err: error }, 'build reconciliation pass failed');
      return 0;
    } finally {
      this.running = false;
    }
  }
}
