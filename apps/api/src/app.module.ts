import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildLoggerOptions } from '@aab/logger';
import type { ApiEnv } from '@aab/shared-config';
import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/http/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from './common/http/response-envelope.interceptor';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { AuthModule } from './modules/auth/auth.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { HealthModule } from './modules/health/health.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { RequirementsModule } from './modules/requirements/requirements.module';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** Accept a well-formed inbound X-Request-ID, otherwise mint one; echo it back. */
export function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  const header = req.headers['x-request-id'];
  const id = typeof header === 'string' && REQUEST_ID_PATTERN.test(header) ? header : randomUUID();
  res.setHeader('x-request-id', id);
  return id;
}

@Module({})
export class AppModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            ...buildLoggerOptions({ name: 'api', level: env.LOG_LEVEL }),
            genReqId: resolveRequestId,
            customAttributeKeys: { reqId: 'requestId' },
            autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
          },
        }),
        InfrastructureModule.register(env),
        AuthModule.register(env),
        HealthModule,
        ProjectsModule,
        RequirementsModule,
        JobsModule,
        DashboardModule,
      ],
      providers: [
        { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    };
  }
}
