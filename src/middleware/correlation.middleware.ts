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
  res: Response,
  next: NextFunction,
): void {
  runInContext(
    {
      idempotencyKey: req.header('idempotency-key') ?? undefined,
      // Not read by this file at all — logOnce below uses req/res directly
      // from this closure. This snapshot exists solely for
      // crash-handlers.ts: a process-level 'uncaughtException' listener
      // has no closure over any request, registered once for the whole
      // process's lifetime — AsyncLocalStorage is the only way it can
      // know what was in flight when it fires.
      req: {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: req.body,
        ip: req.ip,
      },
    },
    () => {
      const startedAt = process.hrtime.bigint();
      let logged = false;

      // One line per request, not two — written from whichever of these
      // fires first. 'finish' is the normal case (response fully sent,
      // success or a handled error alike — ProblemExceptionFilter's own
      // res.json() still triggers it). 'close' covers a client that
      // disconnects before a response ever completes, which 'finish'
      // alone would silently miss entirely.
      const logOnce = (aborted: boolean) => {
        if (logged) return;
        logged = true;

        accessLog.info(
          {
            req: { method: req.method, url: req.url, headers: req.headers },
            body: req.body,
            ip: req.ip,
            status: res.statusCode,
            'duration-ms': Number(process.hrtime.bigint() - startedAt) / 1e6,
            ...(aborted && { aborted: true }),
          },
          'request completed',
        );
      };

      res.on('finish', () => logOnce(false));
      res.on('close', () => logOnce(!res.writableEnded));

      next();
    },
  );
}
