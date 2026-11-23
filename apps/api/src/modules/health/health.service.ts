import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma.service';
import { RedisService } from '../../infrastructure/redis.service';

export type DependencyState = 'up' | 'down';

export interface ReadinessReport {
  status: 'ok' | 'error';
  checks: { database: DependencyState; redis: DependencyState };
}

const CHECK_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async readiness(): Promise<ReadinessReport> {
    const [database, redis] = await Promise.all([
      this.probe(() => this.prisma.client.$queryRaw`SELECT 1`),
      this.probe(() => this.redis.client.ping()),
    ]);
    return {
      status: database === 'up' && redis === 'up' ? 'ok' : 'error',
      checks: { database, redis },
    };
  }

  private async probe(check: () => Promise<unknown>): Promise<DependencyState> {
    try {
      await withTimeout(check(), CHECK_TIMEOUT_MS);
      return 'up';
    } catch {
      // The failing dependency is reported in the readiness payload.
      return 'down';
    }
  }
}
