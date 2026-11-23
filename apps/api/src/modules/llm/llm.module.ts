import { createLlmProvider } from '@aab/llm-adapters';
import { LogMetrics, createLogger } from '@aab/logger';
import type { ApiEnv } from '@aab/shared-config';
import { type DynamicModule, Global, Module } from '@nestjs/common';
import { LlmUsageService } from './llm-usage.service';
import { LLM_PROVIDER, METRICS } from './llm.tokens';

/**
 * Provides the configured LLM provider (server-side credentials only) and the
 * usage-recording wrapper. Real providers are only constructed when their
 * credentials are configured; otherwise the deterministic mock is used.
 */
@Global()
@Module({})
export class LlmModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: LlmModule,
      providers: [
        { provide: LLM_PROVIDER, useFactory: () => createLlmProvider(env) },
        {
          provide: METRICS,
          useFactory: () =>
            new LogMetrics(createLogger({ name: 'api-metrics', level: env.LOG_LEVEL })),
        },
        LlmUsageService,
      ],
      exports: [LLM_PROVIDER, METRICS, LlmUsageService],
    };
  }
}
