import { describe, expect, it } from 'vitest';
import { InvalidEnvironmentError, apiEnvSchema, parseEnv, workerEnvSchema } from './env';

const validApi = {
  DATABASE_URL: 'postgresql://aab:aab@localhost:5432/aab',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a'.repeat(40),
};

describe('parseEnv', () => {
  it('applies defaults for mock mode without any AI credentials', () => {
    const env = parseEnv(apiEnvSchema, validApi);
    expect(env.LLM_PROVIDER).toBe('mock');
    expect(env.API_PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('fails fast when required variables are missing', () => {
    expect(() => parseEnv(apiEnvSchema, {})).toThrow(InvalidEnvironmentError);
  });

  it('rejects a short JWT secret', () => {
    expect(() => parseEnv(apiEnvSchema, { ...validApi, JWT_SECRET: 'short' })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('rejects placeholder JWT secrets in production', () => {
    expect(() =>
      parseEnv(apiEnvSchema, {
        ...validApi,
        NODE_ENV: 'production',
        JWT_SECRET: 'change-me-change-me-change-me-change-me',
      }),
    ).toThrow(/placeholder/);
  });

  it('requires the provider key when a real LLM provider is selected', () => {
    expect(() => parseEnv(apiEnvSchema, { ...validApi, LLM_PROVIDER: 'openai' })).toThrow(
      /OPENAI_API_KEY/,
    );
  });

  it('never includes secret values in the error message', () => {
    const secret = 'super-secret-value';
    try {
      parseEnv(apiEnvSchema, { ...validApi, JWT_SECRET: secret, REDIS_URL: 'not a url' });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it('rejects unknown agent runtimes for the worker', () => {
    expect(() => parseEnv(workerEnvSchema, { ...validApi, AGENT_RUNTIME: 'claude-code' })).toThrow(
      /AGENT_RUNTIME/,
    );
  });
});
