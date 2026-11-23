import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { findWorkspaceRoot } from './dotenv';

// Required with no default: a deploy that forgets NODE_ENV must fail to start
// rather than silently run with development behaviour (insecure cookies, docs).
const nodeEnv = z.enum(['development', 'test', 'production']);
const booleanFlag = z.enum(['true', 'false']).transform((v) => v === 'true');
const logLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info');
const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const optionalSecret = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v : undefined));

const llmFields = {
  LLM_PROVIDER: z.enum(['mock', 'openai', 'anthropic']).default('mock'),
  LLM_MODEL: z.string().optional(),
  LLM_TIMEOUT_MS: positiveInt(60_000),
  OPENAI_API_KEY: optionalSecret,
  ANTHROPIC_API_KEY: optionalSecret,
};

const baseFields = {
  NODE_ENV: nodeEnv,
  LOG_LEVEL: logLevel,
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  // Relative paths resolve against the monorepo root so API and worker agree
  // on one location regardless of each process's working directory.
  ARTIFACT_STORAGE_PATH: z
    .string()
    .min(1)
    .default('./.artifacts')
    .transform((path) =>
      isAbsolute(path) ? path : resolve(findWorkspaceRoot() ?? process.cwd(), path),
    ),
  /** BullMQ key prefix; isolates environments (and test runs) sharing one Redis. */
  QUEUE_PREFIX: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .default('aab'),
  MAX_BUILD_ATTEMPTS: positiveInt(3),
  ...llmFields,
};

/** Placeholder values that must never reach production. */
const INSECURE_SECRET_MARKERS = ['change-me', 'changeme', 'dev-only', 'secret'];

type LlmEnv = { LLM_PROVIDER: string; OPENAI_API_KEY?: string; ANTHROPIC_API_KEY?: string };

function requireProviderKey(env: LlmEnv, ctx: z.RefinementCtx): void {
  if (env.LLM_PROVIDER === 'openai' && !env.OPENAI_API_KEY) {
    ctx.addIssue({
      code: 'custom',
      path: ['OPENAI_API_KEY'],
      message: 'required when LLM_PROVIDER=openai',
    });
  }
  if (env.LLM_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
    ctx.addIssue({
      code: 'custom',
      path: ['ANTHROPIC_API_KEY'],
      message: 'required when LLM_PROVIDER=anthropic',
    });
  }
}

export const apiEnvSchema = z
  .object({
    ...baseFields,
    API_PORT: positiveInt(4000),
    JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_EXPIRES_IN_SECONDS: positiveInt(3600),
    OUTBOX_POLL_INTERVAL_MS: positiveInt(1000),
    /** Active builds without a worker heartbeat for this long are reconciled. */
    STALE_BUILD_SECONDS: positiveInt(120),
    RECONCILE_INTERVAL_MS: positiveInt(30_000),
    /** Defaults to true outside development/test. */
    COOKIE_SECURE: booleanFlag.optional(),
    /** Swagger UI; defaults to enabled only in development/test. */
    API_DOCS_ENABLED: booleanFlag.optional(),
  })
  .superRefine((env, ctx) => {
    requireProviderKey(env, ctx);
    const local = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
    const lowered = env.JWT_SECRET.toLowerCase();
    if (!local && INSECURE_SECRET_MARKERS.some((marker) => lowered.includes(marker))) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'looks like a placeholder; set a strong random secret outside development',
      });
    }
    if (!local && env.JWT_SECRET.length < 43) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'must be at least 43 characters (256-bit) outside development',
      });
    }
  })
  .transform((env) => {
    const local = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
    return {
      ...env,
      COOKIE_SECURE: env.COOKIE_SECURE ?? !local,
      API_DOCS_ENABLED: env.API_DOCS_ENABLED ?? local,
    };
  });

export const workerEnvSchema = z
  .object({
    ...baseFields,
    WORKER_CONCURRENCY: positiveInt(2),
    AGENT_RUNTIME: z.enum(['mock']).default('mock'),
    SANDBOX_PROVIDER: z.enum(['mock']).default('mock'),
    MAX_REPAIR_ATTEMPTS: z.coerce.number().int().min(0).max(10).default(2),
    BUILD_TIMEOUT_SECONDS: positiveInt(600),
    /** Artificial per-step delay so mock progress is observable in the UI. */
    MOCK_STEP_DELAY_MS: z.coerce.number().int().min(0).max(60_000).default(400),
    WORKER_ID: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => requireProviderKey(env, ctx));

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export class InvalidEnvironmentError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'InvalidEnvironmentError';
  }
}

/**
 * Parse and validate environment variables. Throws InvalidEnvironmentError
 * listing variable names and rules only — never the offending values, which
 * may be secrets.
 */
export function parseEnv<S extends z.ZodType>(
  schema: S,
  source: NodeJS.ProcessEnv = process.env,
): z.infer<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new InvalidEnvironmentError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}
