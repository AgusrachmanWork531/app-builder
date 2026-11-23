import type { ApiEnv } from '@aab/shared-config';
import { RequestMethod } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

export const API_PREFIX = 'api/v1';
export const API_DOCS_PATH = 'api/docs';

/** HTTP pipeline configuration shared by main.ts and integration tests. */
export function configureApp(app: NestExpressApplication, env: ApiEnv): void {
  app.disable('x-powered-by');
  // Security headers. Swagger UI needs inline scripts, so the strict default
  // CSP is only relaxed when API docs are enabled (development by default).
  app.use(helmet({ contentSecurityPolicy: env.API_DOCS_ENABLED ? false : undefined }));
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '256kb' });
  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.enableShutdownHooks();

  if (env.API_DOCS_ENABLED) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('AI App Builder Engine API')
        .setDescription('Control plane REST API (mock-first MVP)')
        .setVersion('v1')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup(API_DOCS_PATH, app, document);
  }
}
