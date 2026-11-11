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
}

export const als = new AsyncLocalStorage<RequestContext>();

export function runInContext<T>(ctx: RequestContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export function currentContext(): RequestContext | undefined {
  return als.getStore();
}
