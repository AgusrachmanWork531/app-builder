import { type LlmProvider, MockLlmProvider } from '@aab/llm-adapters';
import { NoopMetrics } from '@aab/logger';
import type { ApiEnv } from '@aab/shared-config';
import { RateLimitError } from '@aab/shared-types';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma.service';
import type { RedisService } from '../../infrastructure/redis.service';
import { LlmUsageService } from './llm-usage.service';

function service(provider: LlmProvider, createImpl: () => Promise<unknown>, count = 1) {
  const prisma = {
    client: { llmUsageRecord: { create: vi.fn(createImpl) } },
  } as unknown as PrismaService;
  const redis = {
    client: { incr: vi.fn(async () => count), expire: vi.fn(async () => 1) },
  } as unknown as RedisService;
  const env = { LLM_REQUESTS_PER_USER_PER_MINUTE: 2, LLM_MAX_CONCURRENCY: 4 } as ApiEnv;
  return new LlmUsageService(prisma, redis, provider, new NoopMetrics(), env);
}

const request = { messages: [{ role: 'user' as const, content: 'hi' }] };
const context = { purpose: 'test', userId: 'u1' };

describe('LlmUsageService', () => {
  it('returns the completion even when the usage write fails', async () => {
    const svc = service(new MockLlmProvider(() => 'ok'), () =>
      Promise.reject(new Error('db down')),
    );
    await expect(svc.complete(request, context)).resolves.toMatchObject({ text: 'ok' });
  });

  it('preserves the provider error when the usage write also fails', async () => {
    const failing: LlmProvider = {
      name: 'midas',
      model: 'deepseek-v4',
      isMock: false,
      complete: () => Promise.reject(new RateLimitError('midas rate limit exceeded')),
    };
    const svc = service(failing, () => Promise.reject(new Error('db down')));
    await expect(svc.complete(request, context)).rejects.toBeInstanceOf(RateLimitError);
  });

  it('enforces the per-user rate limit for paid providers only', async () => {
    const paid: LlmProvider = {
      name: 'midas',
      model: 'deepseek-v4',
      isMock: false,
      complete: new MockLlmProvider().complete.bind(new MockLlmProvider()),
    };
    await expect(service(paid, async () => ({}), 3).complete(request, context)).rejects.toThrow(
      /AI request limit/,
    );
    await expect(
      service(new MockLlmProvider(), async () => ({}), 99).complete(request, context),
    ).resolves.toBeDefined();
  });
});
