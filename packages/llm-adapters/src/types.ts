export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  /** Ask the provider for a JSON object response (when supported). */
  json?: boolean;
  signal?: AbortSignal;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmResponse {
  text: string;
  usage: LlmUsage;
  provider: string;
  model: string;
  latencyMs: number;
}

/**
 * Provider-independent completion interface. Credentials stay inside the
 * adapter instance (server-side only) and are never included in errors.
 */
export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  readonly isMock: boolean;
  complete(request: LlmRequest): Promise<LlmResponse>;
}
