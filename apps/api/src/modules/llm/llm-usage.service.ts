import type { LlmProvider, LlmResponse } from '@aab/llm-adapters';
import type { Metrics } from '@aab/logger';
import type { ApiEnv } from '@aab/shared-config';
import { ExternalProviderError, RateLimitError, toAppError } from '@aab/shared-types';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { API_ENV } from '../../config/api-env.token';
import { PrismaService } from '../../infrastructure/prisma.service';
import { RedisService } from '../../infrastructure/redis.service';
import { LLM_PROVIDER, METRICS } from './llm.tokens';

export interface LlmCallContext {
  purpose: string;
  /** Required for paid providers: per-user rate limiting. */
  userId: string;
  projectId?: string;
  buildJobId?: string;
}

interface CallRecord {
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  success: boolean;
  errorCode?: string;
}

/**
 * Single entry point for LLM calls:
 *  - abuse guards for paid providers: a per-user fixed-window rate limit in
 *    Redis (shared by all API instances) and an in-process concurrency cap;
 *  - best-effort accounting: metrics are emitted once and the usage row is
 *    written without ever masking the provider result or the original error.
 */
@Injectable()
export class LlmUsageService {
  private readonly logger = new Logger(LlmUsageService.name);
  private inFlight = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  get providerInfo(): { name: string; model: string; isMock: boolean } {
    return { name: this.provider.name, model: this.provider.model, isMock: this.provider.isMock };
  }

  async complete(
    request: Parameters<LlmProvider['complete']>[0],
    context: LlmCallContext,
  ): Promise<LlmResponse> {
    if (!this.provider.isMock) await this.enforceUserRateLimit(context.userId);
    if (!this.provider.isMock && this.inFlight >= this.env.LLM_MAX_CONCURRENCY) {
      throw new RateLimitError('The AI provider is busy; retry shortly', 2000);
    }
    this.inFlight++;
    const started = Date.now();
    let response: LlmResponse;
    try {
      response = await this.provider.complete(request);
    } catch (error) {
      await this.account(context, {
        model: this.provider.model,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - started,
        success: false,
        errorCode: toAppError(error).code,
      });
      throw error;
    } finally {
      this.inFlight--;
    }
    await this.account(context, {
      model: response.model,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      latencyMs: response.latencyMs,
      success: true,
    });
    return response;
  }

  private async enforceUserRateLimit(userId: string): Promise<void> {
    const window = Math.floor(Date.now() / 60_000);
    const key = `aab:llm-rate:${userId}:${window}`;
    let count: number;
    try {
      count = await this.redis.client.incr(key);
      if (count === 1) await this.redis.client.expire(key, 90);
    } catch (error) {
      // Fail closed: paid calls are not allowed when the limiter is unavailable.
      throw new ExternalProviderError('Rate limiter unavailable; retry shortly', {
        retryable: true,
        cause: error,
      });
    }
    if (count > this.env.LLM_REQUESTS_PER_USER_PER_MINUTE) {
      throw new RateLimitError(
        `AI request limit reached (${this.env.LLM_REQUESTS_PER_USER_PER_MINUTE}/minute); retry shortly`,
        60_000 - (Date.now() % 60_000),
      );
    }
  }

  /** Emit metrics once and persist the usage row; never throws. */
  private async account(context: LlmCallContext, call: CallRecord): Promise<void> {
    const labels = { provider: this.provider.name, model: call.model, purpose: context.purpose };
    this.metrics.increment('llm_tokens_total', call.inputTokens + call.outputTokens, labels);
    this.metrics.observe('llm_request_latency_ms', call.latencyMs, {
      ...labels,
      success: call.success,
    });
    try {
      await this.prisma.client.llmUsageRecord.create({
        data: {
          provider: this.provider.name,
          model: call.model.slice(0, 128),
          purpose: context.purpose,
          projectId: context.projectId ?? null,
          buildJobId: context.buildJobId ?? null,
          inputTokens: call.inputTokens,
          outputTokens: call.outputTokens,
          // Pricing differs per gateway/contract; null until a price table is configured.
          costUsd: null,
          latencyMs: call.latencyMs,
          success: call.success,
          errorCode: call.errorCode ?? null,
        },
      });
    } catch (error) {
      this.logger.warn({ err: error, purpose: context.purpose }, 'failed to record LLM usage');
    }
  }
}
