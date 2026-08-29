import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import path from 'node:path';

import { ProblemExceptionFilter } from './filters/problem-exception.filter.ts';
import { validationErrorHandler } from './middleware/validation-error-handler.ts';
import { AppModule } from './app.module.ts';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  app.use(express.json());

  app.use(
    OpenApiValidator.middleware({
      apiSpec: path.join(process.cwd(), 'openapi/openapi.yaml'),
      validateRequests: true,
      validateResponses: true,
      ignorePaths: /^\/health/,
    }),
  );

  app.use(validationErrorHandler);
  app.useGlobalFilters(new ProblemExceptionFilter());

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Listening on port ${port}`);
}

bootstrap();
