import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createLogger } from '@smart-hr/observability';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';
import { createValidationPipe } from './common/validation.js';
import type { ApiEnv } from './config/env.js';

export async function createApp(env: ApiEnv): Promise<NestExpressApplication> {
  const logger = createLogger({
    service: 'api',
    level: env.LOG_LEVEL,
    base: { deploymentMode: env.DEPLOYMENT_MODE },
  });

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env, logger), {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // one hop: the AWS load balancer
  app.use(helmet());
  app.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new ProblemDetailsFilter(logger));
  app.enableShutdownHooks();

  // The OpenAPI document is published outside production; production serves it only to CI as a build artifact.
  if (env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Smart HR Enterprise API')
      .setVersion('0.1.0')
      .addCookieAuth('session')
      .build();
    SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config));
  }

  return app;
}
