import type { LlmProvider, LlmRequest, LlmResponse } from './types';

/**
 * Deterministic mock: echoes a fixed JSON payload (or a canned reply) so
 * pipelines and tests run without credentials. Never presented as real AI.
 */
export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock';
  readonly model = 'mock-llm';
  readonly isMock = true;

  constructor(private readonly reply: (request: LlmRequest) => string = () => '{"mock":true}') {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const text = this.reply(request);
    const input = request.messages.reduce((sum, m) => sum + m.content.length, 0);
    return {
      text,
      usage: { inputTokens: Math.ceil(input / 4), outputTokens: Math.ceil(text.length / 4) },
      provider: this.name,
      model: this.model,
      latencyMs: 0,
    };
  }
}
