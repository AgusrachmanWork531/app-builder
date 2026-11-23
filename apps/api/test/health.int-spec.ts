import { apiEnvSchema, loadWorkspaceDotenv, parseEnv } from '@aab/shared-config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('health (integration: requires PostgreSQL + Redis)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    loadWorkspaceDotenv();
    const env = parseEnv(apiEnvSchema, { ...process.env, LOG_LEVEL: 'warn' });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register(env)],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app, env);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /health/live → 200', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200, { status: 'ok' });
  });

  it('GET /health/ready → 200 with database and redis up', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  it('echoes a valid X-Request-ID and mints one otherwise', async () => {
    const echoed = await request(app.getHttpServer())
      .get('/health/live')
      .set('x-request-id', 'trace-abc-123');
    expect(echoed.headers['x-request-id']).toBe('trace-abc-123');

    const minted = await request(app.getHttpServer())
      .get('/health/live')
      .set('x-request-id', 'bad value with spaces');
    expect(minted.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('serves the OpenAPI document outside production', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    expect(res.body.info.title).toBe('AI App Builder Engine API');
  });
});
