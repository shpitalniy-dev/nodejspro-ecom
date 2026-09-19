import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import path from 'node:path';

import { ProblemExceptionFilter } from './filters/problem-exception.filter.ts';
import { validationErrorHandler } from './middleware/validation-error-handler.ts';

// Everything bootstrap() does to a freshly created Nest app except
// listen() — shared by src/index.ts and the E2E testkit, so an E2E test
// exercises the exact same body parser / OpenAPI validation / error
// handling prod does, not a stripped-down stand-in.
export function configureApp(app: NestExpressApplication): void {
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
  // whitelist strips unknown properties silently rather than rejecting —
  // the OpenAPI middleware above already rejects them (with the specific
  // "must NOT have additional properties" body contract/check.js asserts
  // on) before a request ever reaches this pipe, so this is a defense-in-
  // depth backstop, not the primary gate for that case.
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
}
