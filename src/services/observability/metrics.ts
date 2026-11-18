// RED metrics (Rate/Errors/Duration) for every HTTP request — one shared
// Registry, read by metrics.controller.ts's /metrics route and written by
// red-metrics.middleware.ts. `route` is always the matched Express
// template (e.g. /orders/:orderId), never the raw path — a raw path would
// make every distinct resource id its own time series (see this module's
// own demo, demo-metrics.ts, step 2).
import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from 'prom-client';

export const registry = new Registry();

// Process/runtime metrics (CPU, memory, event-loop lag, GC, open handles)
// — the baseline every prom-client service is expected to expose
// alongside its own RED metrics, not something specific to this app's
// routes. Separate metric names (process_*, nodejs_*), so this has no
// effect on the route-scoped http_requests_total checks demo-metrics.ts
// runs.
collectDefaultMetrics({ register: registry });

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests by method, route and status code',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});

// Comfortably above anything this app's own request handlers produce
// in-process (no network hop) — above-top-bucket is expected to compute
// to 0, not special-cased to 0.
export const DURATION_BUCKETS = [
  0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5,
] as const;

export const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds by method and route',
  labelNames: ['method', 'route'] as const,
  buckets: [...DURATION_BUCKETS],
  registers: [registry],
});
