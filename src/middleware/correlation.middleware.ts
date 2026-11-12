// Mounted once, right after express.json() (configure-app.ts) — every
// layer below this point (guards, controller, service, checkout) runs
// inside the one ALS context this opens, and can read it back via
// currentContext() without req ever being passed down as an argument.
// AuthGuard enriches this same store with userId once it resolves the
// JWT; this middleware runs before auth, so it only knows idempotencyKey.
import type { NextFunction, Request, Response } from 'express';

import { runInContext } from '../services/observability/context.ts';
import { logger } from '../services/observability/logger.service.ts';

const accessLog = logger.child({ layer: 'http' });

export function correlationMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  runInContext(
    { idempotencyKey: req.header('idempotency-key') ?? undefined },
    () => {
      // req and body are logged as their own top-level fields (not nested
      // inside one object) so the redact config's paths
      // (req.headers.authorization, body.password, *.token) land where
      // they actually say they will. ip is its own field, not nested under
      // req, so it survives even if req.headers ever needs redacting
      // wholesale.
      accessLog.info(
        {
          req: { method: req.method, url: req.url, headers: req.headers },
          body: req.body,
          ip: req.ip,
        },
        'request received',
      );
      next();
    },
  );
}
