import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';

export type { Logger } from 'pino';

/** Standard execution-context fields attached to log lines. */
export interface LogContext {
  requestId?: string;
  correlationId?: string;
  projectId?: string;
  buildId?: string;
  taskId?: string;
  workerId?: string;
  executionStep?: string;
  status?: string;
  durationMs?: number;
  errorCode?: string;
}

/**
 * Paths whose values are always replaced with "[REDACTED]". Covers HTTP
 * credentials, passwords, tokens and provider API keys at any nesting level
 * pino supports.
 */
const SENSITIVE_KEYS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secret',
  'authorization',
  'Authorization',
  'cookie',
  'databaseUrl',
  'connectionString',
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'DEV_SEED_PASSWORD',
];

const SENSITIVE_HEADERS = ['authorization', 'Authorization', 'cookie', 'x-api-key', 'set-cookie'];

/**
 * Paths whose values are replaced with "[REDACTED]". pino paths are
 * case-sensitive and depth-specific, so keys are covered at depth 0–2 and
 * headers wherever HTTP/provider objects commonly carry them.
 */
export const REDACT_PATHS = [
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]),
  ...SENSITIVE_HEADERS.flatMap((header) => [
    `headers["${header}"]`,
    `*.headers["${header}"]`,
    `*.*.headers["${header}"]`,
  ]),
];

export interface CreateLoggerOptions {
  name: string;
  level?: LoggerOptions['level'];
  base?: Record<string, unknown>;
}

export function buildLoggerOptions(options: CreateLoggerOptions): LoggerOptions {
  return {
    name: options.name,
    level: options.level ?? 'info',
    base: { service: options.name, ...options.base },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  };
}

export function createLogger(
  options: CreateLoggerOptions,
  destination?: DestinationStream,
): Logger {
  const opts = buildLoggerOptions(options);
  return destination ? pino(opts, destination) : pino(opts);
}

export function withContext(logger: Logger, context: LogContext): Logger {
  return logger.child(context);
}

export * from './metrics';
