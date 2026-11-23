import {
  type AgentContext,
  type AgentRuntime,
  type AppSpecification,
  type ExecutionPlanDraft,
  type GeneratedFile,
  type SandboxWorkspace,
  type ValidationIssue,
  type ValidationReport,
  appSpecificationSchema,
} from '@aab/agent-core';
import { CancellationError, TimeoutError } from '@aab/shared-types';

export const MOCK_BANNER =
  'MOCK ARTIFACT: produced by the deterministic MockAgentRuntime. No AI model was called and this is not working application code.';

const ROUTE_VERBS = ['list', 'get', 'create', 'update', 'delete'] as const;

/** Sleep that rejects when the build is cancelled or times out. */
export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new CancellationError();
}

function fileSet(spec: AppSpecification): Record<string, { taskKey: string; content: string }> {
  const prismaModels = spec.entities
    .map(
      (entity) =>
        `model ${entity.name} {\n  id String @id @default(uuid())\n${entity.fields
          .map((f) => `  ${f.name} ${prismaType(f.type)}${f.required ? '' : '?'}`)
          .join('\n')}\n}`,
    )
    .join('\n\n');
  const routes = spec.entities.flatMap((entity) =>
    ROUTE_VERBS.map((verb) => ({ entity: entity.name, operation: verb })),
  );

  return {
    'MOCK_README.md': {
      taskKey: 'scaffold',
      content: `# ${spec.appName}\n\n> ${MOCK_BANNER}\n\n${spec.summary}\n\nFeatures:\n${spec.features.map((f) => `- ${f}`).join('\n')}\n`,
    },
    'app-spec.json': { taskKey: 'scaffold', content: `${JSON.stringify(spec, null, 2)}\n` },
    'prisma/schema.mock.prisma': {
      taskKey: 'data-model',
      content: `// ${MOCK_BANNER}\n\n${prismaModels}\n`,
    },
    'api/routes.mock.json': {
      taskKey: 'api',
      content: `${JSON.stringify({ mock: true, routes }, null, 2)}\n`,
    },
    'ui/pages.mock.json': {
      taskKey: 'ui',
      content: `${JSON.stringify({ mock: true, pages: spec.pages }, null, 2)}\n`,
    },
  };
}

function prismaType(type: AppSpecification['entities'][number]['fields'][number]['type']): string {
  switch (type) {
    case 'number':
      return 'Float';
    case 'boolean':
      return 'Boolean';
    case 'datetime':
      return 'DateTime';
    default:
      return 'String';
  }
}

/**
 * Deterministic development runtime. Produces the same plan and files for
 * the same specification; every output is labeled as mock.
 */
export class MockAgentRuntime implements AgentRuntime {
  readonly name = 'mock-agent';
  readonly isMock = true;

  constructor(private readonly stepDelayMs: number) {}

  async plan(context: AgentContext): Promise<ExecutionPlanDraft> {
    await abortableDelay(this.stepDelayMs, context.signal);
    return {
      summary: `[MOCK] Plan for "${context.specification.appName}": ${context.specification.entities.length} entities, ${context.specification.pages.length} pages`,
      tasks: [
        { key: 'scaffold', title: 'Scaffold project structure' },
        { key: 'data-model', title: 'Generate data model' },
        { key: 'api', title: 'Generate API routes' },
        { key: 'ui', title: 'Generate UI pages' },
        { key: 'validation', title: 'Validate generated artifacts' },
      ],
    };
  }

  async generate(
    context: AgentContext,
    _plan: ExecutionPlanDraft,
    workspace: SandboxWorkspace,
  ): Promise<GeneratedFile[]> {
    const generated: GeneratedFile[] = [];
    for (const [path, file] of Object.entries(fileSet(context.specification))) {
      await abortableDelay(this.stepDelayMs / 4, context.signal);
      await workspace.writeFile(path, file.content);
      generated.push({ path, taskKey: file.taskKey });
    }
    return generated;
  }

  async validate(
    context: AgentContext,
    _plan: ExecutionPlanDraft,
    workspace: SandboxWorkspace,
  ): Promise<ValidationReport> {
    await abortableDelay(this.stepDelayMs, context.signal);
    const expected = Object.keys(fileSet(context.specification));
    const present = new Set(await workspace.listFiles());
    const issues: ValidationIssue[] = expected
      .filter((path) => !present.has(path))
      .map((path) => ({ path, message: 'expected file is missing' }));

    if (present.has('app-spec.json')) {
      const parsed = appSpecificationSchema.safeParse(
        JSON.parse(await workspace.readFile('app-spec.json')),
      );
      if (!parsed.success) issues.push({ path: 'app-spec.json', message: 'invalid specification' });
    }
    return { passed: issues.length === 0, checks: expected.length + 1, issues };
  }
}

export function buildTimeoutError(seconds: number): TimeoutError {
  return new TimeoutError(`Build exceeded ${seconds}s timeout`, { retryable: false });
}
