// Records on res 'finish' (after the response is actually sent), not in a
// Nest interceptor — an interceptor's success branch never runs for a
// thrown exception, and by the time one could read the error branch, it
// still doesn't know the final status code ProblemExceptionFilter will
// assign without duplicating that mapping. res.statusCode at 'finish' is
// the one real, final answer, whatever produced it — same technique
// express-prom-bundle and most RED-metrics middleware use.
import type { NextFunction, Request, Response } from 'express';

import {
  httpRequestDurationSeconds,
  httpRequestsTotal,
} from '../services/observability/metrics.ts';

export function redMetricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    // req.route is only set once Express's router has matched — true by
    // 'finish' regardless of outcome. Absent only for a request that never
    // matched any route at all (a 404 before routing), labelled as its own
    // bounded value rather than the raw (unbounded) path.
    const route = req.route?.path ?? 'unmatched';
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;

    httpRequestsTotal.inc({
      method: req.method,
      route,
      status: String(res.statusCode),
    });

    httpRequestDurationSeconds.observe(
      { method: req.method, route },
      durationSeconds,
    );
  });

  next();
}
