import { BUILD_QUEUE_NAME } from '@aab/job-contracts';
import type { ApiEnv } from '@aab/shared-config';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { API_ENV } from '../../config/api-env.token';

/** Transient-failure retries per build attempt (worker-side), with jittered backoff. */
export const QUEUE_JOB_ATTEMPTS = 3;
export const QUEUE_BACKOFF = { type: 'exponential', delay: 2000, jitter: 0.5 } as const;

/** Producer side of the build queue (the API never consumes jobs). */
@Injectable()
export class BuildQueue implements OnModuleDestroy {
  readonly queue: Queue;
  private readonly connection: Redis;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    // Producer connection fails fast while Redis is down (no offline queue), so the
    // outbox dispatcher never blocks an open DB transaction on a dead connection.
    this.connection = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.connection.on('error', () => undefined); // surfaced via publish failures + readiness
    this.queue = new Queue(BUILD_QUEUE_NAME, {
      connection: this.connection,
      prefix: env.QUEUE_PREFIX,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.connection.quit().catch(() => this.connection.disconnect());
  }
}
