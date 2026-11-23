import { ExternalProviderError } from '@aab/shared-types';
import { type FetchFn, postJson } from './http';
import type { LlmProvider, LlmRequest, LlmResponse } from './types';

export interface OpenAiCompatibleOptions {
  /** Provider label used in logs, usage records and errors, e.g. "midas". */
  name: string;
  /** Base URL including the API version, e.g. https://api.openai.com/v1 */
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  fetchFn?: FetchFn;
}

interface ChatCompletionResponse {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Adapter for any OpenAI-compatible Chat Completions endpoint
 * (POST {baseUrl}/chat/completions, Bearer auth). Used for OpenAI itself and
 * for gateways such as Midas (e.g. model "deepseek-v4").
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name: string;
  readonly model: string;
  readonly isMock = false;
  private readonly url: string;
  private readonly fetchFn: FetchFn;

  constructor(private readonly options: OpenAiCompatibleOptions) {
    this.name = options.name;
    this.model = options.model;
    this.url = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();
    const json = (await postJson({
      provider: this.name,
      url: this.url,
      headers: { authorization: `Bearer ${this.options.apiKey}` },
      body: {
        model: this.model,
        messages: request.messages,
        ...(request.maxOutputTokens ? { max_tokens: request.maxOutputTokens } : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.json ? { response_format: { type: 'json_object' } } : {}),
      },
      timeoutMs: this.options.timeoutMs,
      signal: request.signal,
      fetchFn: this.fetchFn,
    })) as ChatCompletionResponse;

    const text = json.choices?.[0]?.message?.content;
    if (typeof text !== 'string') {
      throw new ExternalProviderError(`${this.name} returned no completion content`, {
        retryable: true,
      });
    }
    return {
      text,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      },
      provider: this.name,
      model: json.model ?? this.model,
      latencyMs: Date.now() - started,
    };
  }
}
