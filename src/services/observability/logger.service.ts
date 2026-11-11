import { Injectable } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import pino from 'pino';

import { currentContext } from './context.ts';

// Hides values by EXACT path — a nested path that isn't named here
// (e.g. body.profile.token) is not hidden.
const REDACT_PATHS = [
  'req.headers.authorization',
  'password',
  'body.password',
  '*.token',
];

// mixin runs on every line — this is where trace_id/span_id come from the
// OTel-active span (not a locally generated id, and not stored in our own
// ALS: once otel.ts is wired up, OpenTelemetry's own context manager
// already propagates the active span through every async boundary).
// One shared instance for the whole process — plain functions that aren't
// Nest-managed (checkout.ts, correlation.middleware.ts) import `logger`
// directly instead of going through the injectable LoggerService below,
// so every layer's lines share the same mixin/redact config and a demo can
// capture them all from one place (stdout).
export const logger: pino.Logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    mixin() {
      const spanContext = trace.getActiveSpan()?.spanContext();

      return {
        ...(spanContext && {
          trace_id: spanContext.traceId,
          span_id: spanContext.spanId,
        }),
        ...currentContext(),
      };
    },
    // Without this, pino JSON-stringifies the Error object passed as
    // `err` directly — message/stack are non-enumerable own properties
    // on a real Error, so plain JSON.stringify(err) is "{}": every
    // logError() call would silently log an empty object. This
    // serializer is what actually pulls message/stack/type out.
    serializers: { err: pino.stdSerializers.err },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  },
  // Passed explicitly rather than left to pino's default: with no
  // destination, pino writes straight to fd 1 via its own SonicBoom
  // stream, bypassing process.stdout entirely — demo-utils.ts's
  // captureStdout() patches process.stdout.write, so it would silently
  // capture nothing. Handing pino the process.stdout object itself (a
  // pattern pino's own docs name for exactly this testing use case)
  // keeps every write going through whatever process.stdout.write
  // currently is.
  process.stdout,
);

@Injectable()
export class LoggerService {
  // Tags every line below it with which layer logged it (controller /
  // service / repository) — e.g. logger.child({ layer: 'orders.service' }).
  child(bindings: Record<string, unknown>): pino.Logger {
    return logger.child(bindings);
  }

  logError(error: unknown): void {
    if (error instanceof Error) {
      logger.error({ err: error }, error.message);
    } else {
      logger.error({ value: error }, 'non-Error value thrown');
    }
  }

  async logErrorOrIgnore<T>(fn: () => Promise<T>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.logError(e);
    }
  }
}
