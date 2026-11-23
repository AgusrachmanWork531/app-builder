import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, withContext } from './index';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      cb();
    },
  });
  return { lines, stream };
}

describe('logger', () => {
  it('redacts secrets', () => {
    const { lines, stream } = capture();
    const logger = createLogger({ name: 'test' }, stream);
    logger.info({ password: 'hunter2', config: { apiKey: 'sk-123' } }, 'login');
    expect(JSON.stringify(lines[0])).not.toContain('hunter2');
    expect(JSON.stringify(lines[0])).not.toContain('sk-123');
  });

  it.each([
    [
      'capitalised provider auth header',
      { err: { config: { headers: { Authorization: 'Bearer sk-live' } } } },
    ],
    ['x-api-key header', { req: { headers: { 'x-api-key': 'sk-live' } } }],
    ['response set-cookie', { res: { headers: { 'set-cookie': 'aab_session=sk-live' } } }],
    ['database url', { config: { databaseUrl: 'postgresql://u:sk-live@h/db' } }],
    ['env secrets', { env: { JWT_SECRET: 'sk-live', OPENAI_API_KEY: 'sk-live' } }],
    ['nested refresh token', { a: { b: { refreshToken: 'sk-live' } } }],
  ])('redacts %s', (_label, payload) => {
    const { lines, stream } = capture();
    createLogger({ name: 'test' }, stream).info(payload, 'event');
    expect(JSON.stringify(lines[0])).not.toContain('sk-live');
  });

  it('attaches execution context fields', () => {
    const { lines, stream } = capture();
    const logger = withContext(createLogger({ name: 'test' }, stream), {
      buildId: 'b1',
      executionStep: 'PLANNING',
    });
    logger.info('step');
    expect(lines[0]).toMatchObject({ buildId: 'b1', executionStep: 'PLANNING', service: 'test' });
  });
});
