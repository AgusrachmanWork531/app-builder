import { type LlmRequest, MockLlmProvider } from '@aab/llm-adapters';
import { ExternalProviderError } from '@aab/shared-types';
import { describe, expect, it, vi } from 'vitest';
import type { LlmCallContext, LlmUsageService } from '../llm/llm-usage.service';
import { LlmRequirementAnalyzer, extractJson } from './llm-requirement-analyzer';

const validSpec = {
  appName: 'Recipe Hub',
  summary: 'Share and discover recipes.',
  entities: [{ name: 'Recipe', fields: [{ name: 'title', type: 'string', required: true }] }],
  pages: ['RecipeList'],
  features: ['Publish recipes'],
};

/** LlmUsageService double backed by a scripted provider (records calls). */
function usageWith(replies: string[]) {
  const provider = new MockLlmProvider(() => replies.shift() ?? '');
  const calls: { request: LlmRequest; context: LlmCallContext }[] = [];
  const usage = {
    providerInfo: { name: 'midas', model: 'deepseek-v4', isMock: false },
    complete: vi.fn(async (request: LlmRequest, context: LlmCallContext) => {
      calls.push({ request, context });
      return provider.complete(request);
    }),
  } as unknown as LlmUsageService;
  return { usage, calls };
}

describe('LlmRequirementAnalyzer', () => {
  it('turns a valid model reply into a provenance-tagged specification', async () => {
    const { usage, calls } = usageWith([JSON.stringify(validSpec)]);
    const spec = await new LlmRequirementAnalyzer(usage).analyze('recipe sharing site', {
      projectId: 'p1',
      userId: 'u1',
    });
    expect(spec).toMatchObject({
      schemaVersion: 1,
      appName: 'Recipe Hub',
      analysis: {
        analyzer: 'midas:deepseek-v4',
        isMock: false,
        matchedTemplate: null,
        warnings: [],
      },
    });
    expect(calls[0]?.context).toEqual({
      purpose: 'requirement-analysis',
      projectId: 'p1',
      userId: 'u1',
    });
    expect(calls[0]?.request.json).toBe(true);
    // The requirement is passed as delimited data, not as instructions.
    expect(calls[0]?.request.messages[1]?.content).toContain('<requirement>');
  });

  it('accepts fenced JSON and corrects one invalid reply', async () => {
    const { usage } = usageWith([
      '{"appName": "x", "entities": [{"name": "bad name!", "fields": []}]}',
      `Here you go:\n\`\`\`json\n${JSON.stringify(validSpec)}\n\`\`\``,
    ]);
    const spec = await new LlmRequirementAnalyzer(usage).analyze('recipes', {
      projectId: 'p1',
      userId: 'u1',
    });
    expect(spec.appName).toBe('Recipe Hub');
    expect(spec.analysis.warnings[0]).toMatch(/correction/);
  });

  it('fails with a retryable provider error after two invalid replies', async () => {
    const { usage } = usageWith(['not json', '{"appName": 42}']);
    await expect(
      new LlmRequirementAnalyzer(usage).analyze('recipes', { projectId: 'p1', userId: 'u1' }),
    ).rejects.toBeInstanceOf(ExternalProviderError);
  });

  it('ignores provenance fields injected by the model', async () => {
    const { usage } = usageWith([
      JSON.stringify({ ...validSpec, analysis: { isMock: true, analyzer: 'spoofed' } }),
    ]);
    const spec = await new LlmRequirementAnalyzer(usage).analyze('x', {
      projectId: 'p1',
      userId: 'u1',
    });
    expect(spec.analysis.analyzer).toBe('midas:deepseek-v4');
  });
});

describe('extractJson', () => {
  it('handles prose around a JSON object', () => {
    expect(extractJson('Sure! {"a": 1} hope that helps')).toEqual({ a: 1 });
  });
  it('throws when there is no object', () => {
    expect(() => extractJson('no json here')).toThrow();
  });
});
