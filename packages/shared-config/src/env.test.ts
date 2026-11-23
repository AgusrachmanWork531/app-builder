import { describe, expect, it } from 'vitest';
import { findWorkspaceRoot } from './dotenv';
import { InvalidEnvironmentError, apiEnvSchema, parseEnv, workerEnvSchema } from './env';

const validApi = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://aab:aab@localhost:5432/aab',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a'.repeat(40),
};
const strongSecret = 'Zq3'.repeat(16);

describe('parseEnv', () => {
  it('applies defaults for mock mode without any AI credentials', () => {
    const env = parseEnv(apiEnvSchema, validApi);
    expect(env.LLM_PROVIDER).toBe('mock');
    expect(env.API_PORT).toBe(4000);
    expect(env.COOKIE_SECURE).toBe(false);
    expect(env.API_DOCS_ENABLED).toBe(true);
  });

  it('fails fast when required variables are missing', () => {
    expect(() => parseEnv(apiEnvSchema, {})).toThrow(InvalidEnvironmentError);
  });

  it('requires NODE_ENV explicitly (no silent development default)', () => {
    const { NODE_ENV: _omit, ...rest } = validApi;
    expect(() => parseEnv(apiEnvSchema, rest)).toThrow(/NODE_ENV/);
  });

  it('uses secure defaults in production', () => {
    const env = parseEnv(apiEnvSchema, {
      ...validApi,
      NODE_ENV: 'production',
      JWT_SECRET: strongSecret,
    });
    expect(env.COOKIE_SECURE).toBe(true);
    expect(env.API_DOCS_ENABLED).toBe(false);
  });

  it('rejects low-entropy-length secrets outside development', () => {
    expect(() =>
      parseEnv(apiEnvSchema, { ...validApi, NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(40) }),
    ).toThrow(/43 characters/);
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

  it('resolves a relative artifact path against the workspace root', () => {
    const env = parseEnv(apiEnvSchema, { ...validApi, ARTIFACT_STORAGE_PATH: './.artifacts' });
    expect(env.ARTIFACT_STORAGE_PATH).toBe(`${findWorkspaceRoot()}/.artifacts`);
    const abs = parseEnv(apiEnvSchema, { ...validApi, ARTIFACT_STORAGE_PATH: '/tmp/x' });
    expect(abs.ARTIFACT_STORAGE_PATH).toBe('/tmp/x');
  });

  it('requires Midas base URL and key when LLM_PROVIDER=midas', () => {
    expect(() => parseEnv(apiEnvSchema, { ...validApi, LLM_PROVIDER: 'midas' })).toThrow(
      /MIDAS_API_KEY[\s\S]*MIDAS_BASE_URL|MIDAS_BASE_URL[\s\S]*MIDAS_API_KEY/,
    );
    const env = parseEnv(apiEnvSchema, {
      ...validApi,
      LLM_PROVIDER: 'midas',
      MIDAS_API_KEY: 'k-test',
      MIDAS_BASE_URL: 'https://gateway.example.com/v1',
    });
    expect(env.LLM_PROVIDER).toBe('midas');
    expect(() => parseEnv(apiEnvSchema, { ...validApi, MIDAS_BASE_URL: 'ftp://nope' })).toThrow(
      /MIDAS_BASE_URL/,
    );
  });

  it('requires https for the Midas gateway outside development (loopback excepted)', () => {
    const prod = { ...validApi, NODE_ENV: 'production', JWT_SECRET: strongSecret };
    expect(() =>
      parseEnv(apiEnvSchema, { ...prod, MIDAS_BASE_URL: 'http://gateway.example.com/v1' }),
    ).toThrow(/https/);
    expect(() =>
      parseEnv(apiEnvSchema, { ...prod, MIDAS_BASE_URL: 'http://127.0.0.1:8080/v1' }),
    ).not.toThrow();
    expect(() =>
      parseEnv(apiEnvSchema, { ...prod, MIDAS_BASE_URL: 'https://gateway.example.com/v1' }),
    ).not.toThrow();
  });

  it('rejects unknown agent runtimes for the worker', () => {
    expect(() => parseEnv(workerEnvSchema, { ...validApi, AGENT_RUNTIME: 'claude-code' })).toThrow(
      /AGENT_RUNTIME/,
    );
  });
});
