import type { ApiEnv } from '@aab/shared-config';
import { RequestMethod } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const API_PREFIX = 'api/v1';
export const API_DOCS_PATH = 'api/docs';

/** HTTP pipeline configuration shared by main.ts and integration tests. */
export function configureApp(app: NestExpressApplication, env: ApiEnv): void {
  app.disable('x-powered-by');
  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.enableShutdownHooks();

  if (env.NODE_ENV !== 'production') {
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
