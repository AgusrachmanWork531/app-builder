import { appSpecificationSchema } from '@aab/agent-core';
import { describe, expect, it } from 'vitest';
import { MockRequirementAnalyzer } from './mock-requirement-analyzer';
import { normalizePrompt } from './requirement-analyzer';

const analyzer = new MockRequirementAnalyzer();

describe('MockRequirementAnalyzer', () => {
  it.each([
    ['Build me a todo app', 'task-manager'],
    ['A blog with posts and comments', 'blog'],
    ['Warehouse inventory tracking', 'inventory'],
  ])('matches %j to the %s template', async (prompt, template) => {
    const spec = await analyzer.analyze(prompt);
    expect(spec.analysis).toMatchObject({ isMock: true, matchedTemplate: template });
    expect(appSpecificationSchema.safeParse(spec).success).toBe(true);
  });

  it('is deterministic', async () => {
    expect(await analyzer.analyze('todo list')).toEqual(await analyzer.analyze('todo list'));
  });

  it('falls back to a generic spec with an explicit warning', async () => {
    const spec = await analyzer.analyze('A platform for booking yoga classes');
    expect(spec.analysis.matchedTemplate).toBeNull();
    expect(spec.analysis.warnings.join(' ')).toMatch(/does not understand natural language/);
  });
});

describe('normalizePrompt', () => {
  it('trims, collapses whitespace and strips control characters', () => {
    expect(normalizePrompt('  a\t\tb\n\nc\u0000d  ')).toBe('a b cd');
  });
});
