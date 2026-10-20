import type { IncomingMessage } from 'node:http';
import { NestFactory } from '@nestjs/core';
import type { DynamicModule, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createLogger } from '@smart-hr/observability';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';
import { createValidationPipe } from './common/validation.js';
import type { ApiEnv } from './config/env.js';

/** `extraModules` lets integration tests mount probe controllers next to the real application. */
export async function createApp(
  env: ApiEnv,
  extraModules: (Type | DynamicModule)[] = [],
): Promise<NestExpressApplication> {
  const logger = createLogger({
    service: 'api',
    level: env.LOG_LEVEL,
    base: { deploymentMode: env.DEPLOYMENT_MODE },
  });

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env, logger, extraModules), {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // one hop: the AWS load balancer
  app.use(helmet());
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '100kb' });
  // Biometric machines upload scan lines as plain text, with whatever content type their firmware picks.
  app.useBodyParser('text', {
    limit: '1mb',
    type: (req: IncomingMessage) => req.url?.startsWith('/iclock/') === true,
  });
  app.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    allowedHeaders: ['content-type', 'x-csrf-token', 'x-request-id'],
    exposedHeaders: ['x-request-id', 'retry-after', 'content-disposition'],
  });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new ProblemDetailsFilter(logger));
  app.enableShutdownHooks();

  // The OpenAPI document is published outside production; production serves it only to CI as a build artifact.
  if (env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Smart HR Enterprise API')
      .setVersion('0.1.0')
      .addCookieAuth('shr_session')
      .build();
    SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config));
  }

  return app;
}
