import type { ApiEnv } from '@aab/shared-config';
import { type DynamicModule, Global, Module } from '@nestjs/common';
import { API_ENV } from '../config/api-env.token';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';

@Global()
@Module({})
export class InfrastructureModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: InfrastructureModule,
      providers: [{ provide: API_ENV, useValue: env }, PrismaService, RedisService],
      exports: [API_ENV, PrismaService, RedisService],
    };
  }
}
