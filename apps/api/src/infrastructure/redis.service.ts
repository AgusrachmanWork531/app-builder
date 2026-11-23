import type { ApiEnv } from '@aab/shared-config';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { API_ENV } from '../config/api-env.token';

const CONNECT_WAIT_MS = 5000;

/**
 * General-purpose Redis connection (health checks, pub/sub). BullMQ creates
 * its own connections because it requires `maxRetriesPerRequest: null`.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.client = new Redis(env.REDIS_URL, {
      // Fail fast instead of queueing commands while Redis is unreachable.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
    // Connection errors surface through readiness checks; avoid unhandled 'error' events.
    this.client.on('error', () => undefined);
  }

  /**
   * Wait (bounded) for the initial connection so the first readiness probe is
   * accurate. Never throws: the API still starts and reports not-ready.
   */
  async onModuleInit(): Promise<void> {
    if (this.client.status === 'ready') return;
    const ready = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), CONNECT_WAIT_MS);
      this.client.once('ready', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    if (!ready)
      this.logger.warn(`Redis not ready after ${CONNECT_WAIT_MS}ms; readiness will report down`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
