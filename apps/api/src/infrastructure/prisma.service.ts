import { PrismaClient, createPrismaClient } from '@aab/database';
import type { ApiEnv } from '@aab/shared-config';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { API_ENV } from '../config/api-env.token';

/** Owns the process-wide Prisma client and disconnects it on shutdown. */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.client = createPrismaClient({ databaseUrl: env.DATABASE_URL });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
