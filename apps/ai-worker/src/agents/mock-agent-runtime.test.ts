import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentContext, AppSpecification } from '@aab/agent-core';
import { MockSandboxProvider } from '@aab/sandbox-adapters';
import { CancellationError } from '@aab/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOCK_BANNER, MockAgentRuntime, abortableDelay } from './mock-agent-runtime';

const sampleSpec: AppSpecification = {
  schemaVersion: 1,
  appName: 'Task Manager',
  summary: 'Track tasks',
  entities: [
    {
      name: 'Task',
      fields: [
        { name: 'title', type: 'string', required: true },
        { name: 'done', type: 'boolean', required: true },
      ],
    },
  ],
  pages: ['TaskList'],
  features: ['Create tasks'],
  analysis: { analyzer: 'mock', isMock: true, matchedTemplate: 'task-manager', warnings: [] },
};

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'aab-agent-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function context(signal = new AbortController().signal): AgentContext {
  return { buildJobId: 'b', projectId: 'p', attempt: 1, specification: sampleSpec, signal };
}

describe('MockAgentRuntime', () => {
  it('produces a deterministic plan', async () => {
    const runtime = new MockAgentRuntime(0);
    const [a, b] = await Promise.all([runtime.plan(context()), runtime.plan(context())]);
    expect(a).toEqual(b);
    expect(a.summary).toMatch(/^\[MOCK\]/);
    expect(a.tasks.map((t) => t.key)).toContain('validation');
  });

  it('generates mock-labeled files that pass validation', async () => {
    const runtime = new MockAgentRuntime(0);
    const ws = await new MockSandboxProvider(root).createWorkspace('w');
    const plan = await runtime.plan(context());
    const files = await runtime.generate(context(), plan, ws);
    expect(files.map((f) => f.path)).toContain('app-spec.json');
    expect(await ws.readFile('MOCK_README.md')).toContain(MOCK_BANNER);
    await expect(runtime.validate(context(), plan, ws)).resolves.toMatchObject({ passed: true });
  });

  it('fails validation when an expected file is missing', async () => {
    const runtime = new MockAgentRuntime(0);
    const ws = await new MockSandboxProvider(root).createWorkspace('empty');
    const report = await runtime.validate(context(), await runtime.plan(context()), ws);
    expect(report.passed).toBe(false);
    expect(report.issues.length).toBeGreaterThan(0);
  });

  it('stops when the build is cancelled', async () => {
    const controller = new AbortController();
    const pending = abortableDelay(10_000, controller.signal);
    controller.abort(new CancellationError());
    await expect(pending).rejects.toBeInstanceOf(CancellationError);
  });
});
