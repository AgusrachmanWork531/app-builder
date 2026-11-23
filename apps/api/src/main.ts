import 'reflect-metadata';
import { apiEnvSchema, loadWorkspaceDotenv, parseEnv } from '@aab/shared-config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { API_DOCS_PATH, configureApp } from './app.setup';

async function bootstrap(): Promise<void> {
  loadWorkspaceDotenv();
  const env = parseEnv(apiEnvSchema); // fail fast on invalid configuration

  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(env), {
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  configureApp(app, env);

  await app.listen(env.API_PORT);
  logger.log(
    `API listening on :${env.API_PORT} (docs: ${env.NODE_ENV === 'production' ? 'disabled' : `/${API_DOCS_PATH}`})`,
  );
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
