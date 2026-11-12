import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import helmet from 'helmet';
import path from 'node:path';

import { ProblemExceptionFilter } from './filters/problem-exception.filter.ts';
import { correlationMiddleware } from './middleware/correlation.middleware.ts';
import { redMetricsMiddleware } from './middleware/red-metrics.middleware.ts';
import { validationErrorHandler } from './middleware/validation-error-handler.ts';
import { stripDangerousKeys } from './utils/object.ts';

// Everything bootstrap() does to a freshly created Nest app except
// listen() — shared by src/index.ts and the E2E testkit, so an E2E test
// exercises the exact same body parser / OpenAPI validation / error
// handling prod does, not a stripped-down stand-in.
export function configureApp(app: NestExpressApplication): void {
  // First of all — duration should cover the whole request, not just the
  // part after helmet/body-parsing.
  app.use(redMetricsMiddleware);
  app.use(helmet());
  app.use(express.json({ reviver: stripDangerousKeys }));
  // After body parsing (correlation's own access log reads req.body) and
  // before everything else — every guard/controller/service/checkout call
  // below this point runs inside the ALS context it opens.
  app.use(correlationMiddleware);

  // Unsigned — the refresh cookie's own value is opaque and HMAC-hashed
  // server-side before it's ever compared to anything, so a signed-cookie
  // layer on top wouldn't add a real guarantee here.
  app.use(cookieParser());

  app.use(
    OpenApiValidator.middleware({
      apiSpec: path.join(process.cwd(), 'openapi/openapi.yaml'),
      validateRequests: true,
      validateResponses: true,
      // /health, /health/db, /healthz, /readyz: health-check paths, not in
      // the contract at all.
      // /orders/:id/events (HW#18): IS in the contract's URL space in
      // spirit, but validateResponses:true buffers a response to check it
      // against a schema — fundamentally incompatible with an SSE stream
      // that's designed to never end. Excluded here rather than silently
      // left unvalidated by omission.
      // /assets/:key (HW#26 demo:cdn): raw bytes with a per-asset
      // content-type, not a JSON resource this spec's schemas describe.
      // /metrics (HW#29): Prometheus's own text exposition format, not
      // JSON either.
      ignorePaths:
        /^\/health(z|\/db)?$|^\/readyz$|^\/orders\/\d+\/events$|^\/assets\/|^\/metrics$/,
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
