import { randomUUID } from 'node:crypto';
import { type ApiEnv, apiEnvSchema, loadWorkspaceDotenv, parseEnv } from '@aab/shared-config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'argon2';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/infrastructure/prisma.service';

export interface TestApp {
  app: NestExpressApplication;
  env: ApiEnv;
  prisma: PrismaService['client'];
  http: () => ReturnType<typeof request>;
  createUser: (password?: string) => Promise<{ id: string; email: string; password: string }>;
  login: (email: string, password: string) => Promise<string>;
  close: () => Promise<void>;
}

/** Boot the real API (PostgreSQL + Redis) with an isolated BullMQ prefix. */
export async function createTestApp(
  overrides: Partial<Record<string, string>> = {},
): Promise<TestApp> {
  loadWorkspaceDotenv();
  const env = parseEnv(apiEnvSchema, {
    ...process.env,
    LOG_LEVEL: 'fatal',
    // Never call a real (paid) LLM from tests, whatever .env says; tests that need a
    // provider override this with a local fake gateway.
    LLM_PROVIDER: 'mock',
    QUEUE_PREFIX: `aab-test-${randomUUID().slice(0, 8)}`,
    OUTBOX_POLL_INTERVAL_MS: '100',
    ...overrides,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(env)],
  }).compile();
  // TEST_LOGS=1 surfaces Nest logs when debugging a failing integration test.
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: process.env.TEST_LOGS ? ['error', 'warn', 'log'] : false,
  });
  configureApp(app, env);
  await app.init();

  const prisma = app.get(PrismaService).client;
  const users: string[] = [];
  const http = () => request(app.getHttpServer());

  return {
    app,
    env,
    prisma,
    http,
    async createUser(password = 'correct-horse-battery') {
      const email = `user-${randomUUID()}@test.local`;
      const user = await prisma.user.create({
        data: { email, passwordHash: await hash(password) },
      });
      users.push(user.id);
      return { id: user.id, email, password };
    },
    async login(email, password) {
      const res = await http()
        .post('/api/v1/auth/login?responseMode=token')
        .send({ email, password })
        .expect(200);
      return res.body.data.accessToken as string;
    },
    async close() {
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await app.close();
    },
  };
}
