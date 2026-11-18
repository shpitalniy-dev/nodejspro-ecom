// Request-scoped fields that aren't already carried by OpenTelemetry's own
// span context (trace_id/span_id come straight from the active span in
// logger.service.ts's mixin, not from here). Set once per request by
// correlation.middleware.ts, read by any layer below it without req ever
// being passed down as an argument.
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  userId?: string;
  tenant?: string;
  idempotencyKey?: string;
  // Forensic snapshot for crash-handlers.ts only — deliberately NOT spread
  // onto every log line by logger.service.ts's mixin (that would put the
  // full request body on every business-logic line); a process-level
  // crash handler has no closure over any request, so this is the only
  // way it can know what was in flight when it fires. Named `req` to
  // match the key every log call already uses for this same shape.
  req?: {
    method: string;
    url: string;
    headers: Record<string, unknown>;
    body: unknown;
    ip: string | undefined;
  };
}

export const als = new AsyncLocalStorage<RequestContext>();

export function runInContext<T>(ctx: RequestContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export function currentContext(): RequestContext | undefined {
  return als.getStore();
}
