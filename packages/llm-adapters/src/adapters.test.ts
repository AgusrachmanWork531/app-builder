import {
  CancellationError,
  ExternalProviderError,
  RateLimitError,
  TimeoutError,
} from '@aab/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from './anthropic';
import { createLlmProvider } from './factory';
import { OpenAiCompatibleProvider } from './openai-compatible';

const SECRET = 'sk-super-secret-key';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function midas(fetchFn: typeof fetch, timeoutMs = 5000) {
  return new OpenAiCompatibleProvider({
    name: 'midas',
    baseUrl: 'https://gateway.example.com/v1/',
    apiKey: SECRET,
    model: 'deepseek-v4-pro',
    timeoutMs,
    fetchFn,
  });
}

describe('OpenAiCompatibleProvider (Midas / deepseek-v4-pro)', () => {
  it('sends an OpenAI-style chat completion request and parses usage', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        model: 'deepseek-v4-pro',
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 12, completion_tokens: 5 },
      }),
    );
    const res = await midas(fetchFn).complete({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      json: true,
      maxOutputTokens: 100,
      temperature: 0,
    });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://gateway.example.com/v1/chat/completions');
    expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(init?.body as string)).toEqual({
      model: 'deepseek-v4-pro',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      max_tokens: 100,
      temperature: 0,
      response_format: { type: 'json_object' },
    });
    expect(res).toMatchObject({
      text: '{"ok":true}',
      usage: { inputTokens: 12, outputTokens: 5 },
      provider: 'midas',
      model: 'deepseek-v4-pro',
    });
  });

  it.each([
    [429, RateLimitError, true],
    [503, ExternalProviderError, true],
    [401, ExternalProviderError, false],
    [400, ExternalProviderError, false],
  ])('classifies HTTP %i', async (status, type, retryable) => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ error: { message: `leaked ${SECRET}` } }, status, { 'retry-after': '2' }),
      );
    const error = await midas(fetchFn)
      .complete({ messages: [{ role: 'user', content: 'x' }] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(type);
    expect((error as ExternalProviderError).retryable).toBe(retryable);
    // Neither the API key nor the provider response body is echoed.
    expect(String((error as Error).message)).not.toContain(SECRET);
    if (status === 429) expect((error as RateLimitError).retryAfterMs).toBe(2000);
  });

  it('times out with a retryable TimeoutError', async () => {
    const fetchFn: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    await expect(
      midas(fetchFn, 20).complete({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it('reports caller cancellation distinctly from timeouts', async () => {
    const fetchFn: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    const controller = new AbortController();
    const pending = midas(fetchFn).complete({
      messages: [{ role: 'user', content: 'x' }],
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(CancellationError);
  });

  it('times out when headers arrive but the body stalls', async () => {
    const fetchFn: typeof fetch = async (_url, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener('abort', () =>
              controller.error(new DOMException('aborted', 'AbortError')),
            );
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    await expect(
      midas(fetchFn, 30).complete({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it('rejects oversized responses and clamps Retry-After', async () => {
    const huge = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('x', { status: 200, headers: { 'content-length': String(10 * 1024 * 1024) } }),
      );
    await expect(
      midas(huge).complete({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ retryable: false });

    const limited = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({}, 429, { 'retry-after': '1000000000' }));
    const error = (await midas(limited)
      .complete({ messages: [{ role: 'user', content: 'x' }] })
      .catch((e: unknown) => e)) as RateLimitError;
    expect(error.retryAfterMs).toBe(60_000);
  });

  it('treats network failures as retryable and responses without content as errors', async () => {
    const down = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    await expect(
      midas(down).complete({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ retryable: true });
    const empty = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ choices: [] }));
    await expect(
      midas(empty).complete({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toBeInstanceOf(ExternalProviderError);
  });
});

describe('AnthropicProvider', () => {
  it('maps system messages and parses text blocks and usage', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        model: 'claude-sonnet-5-5',
        content: [{ type: 'text', text: 'hello' }],
        usage: { input_tokens: 7, output_tokens: 2 },
      }),
    );
    const provider = new AnthropicProvider({
      apiKey: SECRET,
      model: 'claude-sonnet-5-5',
      timeoutMs: 5000,
      fetchFn,
    });
    const res = await provider.complete({
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' },
      ],
    });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(init?.body as string);
    expect(body.system).toBe('be brief');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(res).toMatchObject({ text: 'hello', usage: { inputTokens: 7, outputTokens: 2 } });
  });
});

describe('createLlmProvider', () => {
  it('builds Midas with deepseek-v4-pro as the default model', () => {
    const provider = createLlmProvider({
      LLM_PROVIDER: 'midas',
      LLM_TIMEOUT_MS: 1000,
      MIDAS_API_KEY: SECRET,
      MIDAS_BASE_URL: 'https://gateway.example.com/v1',
    });
    expect(provider).toMatchObject({ name: 'midas', model: 'deepseek-v4-pro', isMock: false });
  });

  it('honours an explicit model and falls back to mock without credentials', () => {
    expect(
      createLlmProvider({
        LLM_PROVIDER: 'midas',
        LLM_MODEL: 'dpe/alias/deepseek-flash',
        LLM_TIMEOUT_MS: 1000,
        MIDAS_API_KEY: SECRET,
        MIDAS_BASE_URL: 'https://gateway.example.com/v1',
      }).model,
    ).toBe('dpe/alias/deepseek-flash');
    expect(createLlmProvider({ LLM_PROVIDER: 'mock', LLM_TIMEOUT_MS: 1000 }).isMock).toBe(true);
    expect(() => createLlmProvider({ LLM_PROVIDER: 'midas', LLM_TIMEOUT_MS: 1000 })).toThrow();
  });
});
