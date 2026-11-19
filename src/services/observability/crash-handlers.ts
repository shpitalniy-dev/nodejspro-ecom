// Node's own docs on 'uncaughtException': "It is not safe to resume normal
// operation after 'uncaughtException'... the process MUST exit." This is
// the one place that contract is honored — log whatever request context
// was active (if any; a crash during startup or a background job has
// none), then exit. Registered once, in src/index.ts only — never in
// configure-app.ts, which runs in five different bootstrap paths
// (the real server, the e2e testkit, three demo scripts); a process-level
// listener added there would duplicate once per call.
import { currentContext } from './context.ts';
import { logger } from './logger.service.ts';

function logFatalAndExit(error: unknown, origin: string): void {
  const request = currentContext()?.req;

  // Destructured the same way correlation.middleware.ts's own completion
  // log does — req.{method,url,headers} plus top-level body/ip, not one
  // bundled object — so REDACT_PATHS's existing req.headers.*/body.password
  // entries apply here too, instead of silently missing a second shape.
  logger.fatal(
    {
      err: error,
      origin,
      ...(request && {
        req: {
          method: request.method,
          url: request.url,
          headers: request.headers,
        },
        body: request.body,
        ip: request.ip,
      }),
    },
    `fatal: ${origin}`,
  );

  process.exit(1);
}

export function registerCrashHandlers(): void {
  process.on('uncaughtException', error =>
    logFatalAndExit(error, 'uncaughtException'),
  );
  process.on('unhandledRejection', reason =>
    logFatalAndExit(reason, 'unhandledRejection'),
  );
}
