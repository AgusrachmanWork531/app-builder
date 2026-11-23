import { DEFAULT_LLM_MODELS } from '@aab/shared-config';
import { ValidationError } from '@aab/shared-types';
import { AnthropicProvider } from './anthropic';
import type { FetchFn } from './http';
import { MockLlmProvider } from './mock';
import { OpenAiCompatibleProvider } from './openai-compatible';
import type { LlmProvider } from './types';

export interface LlmConfig {
  LLM_PROVIDER: 'mock' | 'openai' | 'anthropic' | 'midas';
  LLM_MODEL?: string;
  LLM_TIMEOUT_MS: number;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  MIDAS_API_KEY?: string;
  MIDAS_BASE_URL?: string;
}

/**
 * Build the configured provider. Real providers are only constructed when
 * their credentials are present (the env schema already enforces this; the
 * checks here keep the factory safe on its own).
 */
export function createLlmProvider(config: LlmConfig, fetchFn?: FetchFn): LlmProvider {
  const model = config.LLM_MODEL ?? DEFAULT_LLM_MODELS[config.LLM_PROVIDER];
  const timeoutMs = config.LLM_TIMEOUT_MS;
  switch (config.LLM_PROVIDER) {
    case 'mock':
      return new MockLlmProvider();
    case 'midas':
      if (!config.MIDAS_API_KEY || !config.MIDAS_BASE_URL) {
        throw new ValidationError('Midas requires MIDAS_API_KEY and MIDAS_BASE_URL');
      }
      return new OpenAiCompatibleProvider({
        name: 'midas',
        baseUrl: config.MIDAS_BASE_URL,
        apiKey: config.MIDAS_API_KEY,
        model,
        timeoutMs,
        fetchFn,
      });
    case 'openai':
      if (!config.OPENAI_API_KEY) throw new ValidationError('OpenAI requires OPENAI_API_KEY');
      return new OpenAiCompatibleProvider({
        name: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: config.OPENAI_API_KEY,
        model,
        timeoutMs,
        fetchFn,
      });
    case 'anthropic':
      if (!config.ANTHROPIC_API_KEY)
        throw new ValidationError('Anthropic requires ANTHROPIC_API_KEY');
      return new AnthropicProvider({ apiKey: config.ANTHROPIC_API_KEY, model, timeoutMs, fetchFn });
  }
}
