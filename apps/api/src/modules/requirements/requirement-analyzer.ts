import type { AppSpecification } from '@aab/agent-core';

/** Converts a normalized prompt into a structured application specification. */
export interface RequirementAnalyzer {
  readonly name: string;
  analyze(normalizedPrompt: string): Promise<AppSpecification>;
}

export const REQUIREMENT_ANALYZER = Symbol('REQUIREMENT_ANALYZER');

// Matching control characters is the point of this pattern.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Trim, strip control characters and collapse whitespace. */
export function normalizePrompt(raw: string): string {
  return raw.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
}
