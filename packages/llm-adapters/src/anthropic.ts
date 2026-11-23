import { ExternalProviderError } from '@aab/shared-types';
import { type FetchFn, postJson } from './http';
import type { LlmProvider, LlmRequest, LlmResponse } from './types';

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  baseUrl?: string;
  fetchFn?: FetchFn;
}

interface MessagesResponse {
  model?: string;
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

const DEFAULT_MAX_TOKENS = 4096;

/** Adapter for the Anthropic Messages API (POST /v1/messages). */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  readonly model: string;
  readonly isMock = false;
  private readonly url: string;
  private readonly fetchFn: FetchFn;

  constructor(private readonly options: AnthropicOptions) {
    this.model = options.model;
    this.url = `${(options.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '')}/v1/messages`;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();
    const system = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const json = (await postJson({
      provider: this.name,
      url: this.url,
      headers: { 'x-api-key': this.options.apiKey, 'anthropic-version': '2023-06-01' },
      body: {
        model: this.model,
        max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
        ...(system ? { system } : {}),
        messages: request.messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({ role: m.role, content: m.content })),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      },
      timeoutMs: this.options.timeoutMs,
      signal: request.signal,
      fetchFn: this.fetchFn,
    })) as MessagesResponse;

    const text = (json.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('');
    if (!text) {
      throw new ExternalProviderError('anthropic returned no text content', { retryable: true });
    }
    return {
      text,
      usage: {
        inputTokens: json.usage?.input_tokens ?? 0,
        outputTokens: json.usage?.output_tokens ?? 0,
      },
      provider: this.name,
      model: json.model ?? this.model,
      latencyMs: Date.now() - started,
    };
  }
}
