import 'reflect-metadata';

import { trace } from '@opentelemetry/api';

import { startDemoApp } from '../../../controllers/auth/demo/demo.utils.ts';
import { Product } from '../../../entities/product.entity.ts';
import { waitUntil } from '../../../utils/wait-until.ts';
import { DataSourceService } from '../../data-source.service.ts';

import { captureStdout, parseJsonLines, resetStock } from './demo-utils.ts';

// demo:trace — HW #29 (c), the main proof. One key opens two doors: the
// trace_id a request's log line carries must equal both the span's own
// trace id (queried back from the trace backend) and the one this demo
// itself started — proving the key is one real identity, not three
// coincidentally-similar strings.
//
// The demo is the trace's own originator: `tracer.startActiveSpan()`
// starts a real span (same as any real client calling this API), and
// OTel's own http/undici auto-instrumentation propagates it onto the
// outgoing fetch automatically — no hand-built `traceparent` header, no
// suppressing the auto-instrumentation to avoid colliding with one. That
// collision (two traceparent values, comma-joined, server mis-parsing
// both into a fresh trace) is exactly what a hand-built header caused
// before this was rewritten to just use the tracer API directly.
//
// Verified live (Stage 6) against Tempo v2.8.2: GET /api/traces/<id>
// returns raw OTLP-JSON, not the Jaeger-compatible shape this was
// originally written against (an unverified guess that turned out wrong)
// — ids are base64-encoded, and spans live at
// batches[].scopeSpans[].spans[], each with a `parentSpanId` (absent on
// the root span) and a `status: { code?: 'STATUS_CODE_ERROR' }`. The wait
// below is also wider than first written (10s -> 30s): export + Tempo's
// own ingest-to-queryable latency occasionally exceeded 10s in practice.
const TRACE_API_URL = process.env.TRACE_API_URL ?? 'http://127.0.0.1:22904';

// Raw OTLP-JSON shape; spanId/parentSpanId are base64 here, decoded to hex
// below so they're comparable with our own hex trace/span ids.
interface RawTempoSpan {
  spanId: string;
  parentSpanId?: string;
  status?: { code?: string; message?: string };
}

interface TempoTraceResponse {
  batches?: { scopeSpans?: { spans?: RawTempoSpan[] }[] }[];
}

interface TempoSpan {
  spanId: string;
  parentSpanId?: string;
  status?: { code?: string; message?: string };
}

function hexId(base64Id: string): string {
  return Buffer.from(base64Id, 'base64').toString('hex');
}

async function fetchTrace(traceId: string): Promise<TempoSpan[]> {
  let spans: TempoSpan[] = [];
  let previousCount = -1;

  // A span's parent (e.g. the root "POST" span, which only ends once the
  // whole response has flushed) can land in a LATER export batch than its
  // children — so "spans.length > 0" alone can return a partial, still-
  // growing trace with a real orphan in it (confirmed live: exactly this
  // happened with a 20s single-check wait). Waiting for the count to come
  // back unchanged twice in a row is what actually means "done arriving".
  await waitUntil(
    async () => {
      const res = await fetch(`${TRACE_API_URL}/api/traces/${traceId}`);

      if (!res.ok) return false;

      const body = (await res.json()) as TempoTraceResponse;
      const rawSpans = (body.batches ?? []).flatMap(
        batch => batch.scopeSpans?.flatMap(scope => scope.spans ?? []) ?? [],
      );

      spans = rawSpans.map(span => ({
        spanId: hexId(span.spanId),
        // Proto3 JSON omits a zero-value field entirely, but can also
        // serialize empty bytes as "" — treat both as "no parent".
        parentSpanId: span.parentSpanId ? hexId(span.parentSpanId) : undefined,
        status: span.status,
      }));

      const stable = spans.length > 0 && spans.length === previousCount;

      previousCount = spans.length;

      return stable;
    },
    30_000,
    1_000,
  );

  return spans;
}

// A span whose parent isn't anywhere in this trace's own span set — a real
// integrity problem (a span lost in the middle of the tree), not expected
// behavior. Since this demo is the trace's own originator (no incoming
// traceparent standing in for an un-exported upstream caller), every real
// parent reference should resolve inside the trace Tempo hands back.
function isOrphan(span: TempoSpan, spanIds: Set<string>): boolean {
  return span.parentSpanId !== undefined && !spanIds.has(span.parentSpanId);
}

async function main(): Promise<void> {
  const { app, baseUrl, close } = await startDemoApp();
  const failures: string[] = [];
  const tracer = trace.getTracer('demo-trace');

  try {
    const manager = await app.get(DataSourceService).getManager();
    const [product] = await manager.getRepository(Product).find({ take: 1 });

    if (!product) {
      throw new Error(
        'demo:trace needs a seeded product — run npm run seed first',
      );
    }

    // Two real orders are placed below (one forced to fail after the
    // outbox write, so stock is still spent first) — reset first so this
    // is rerunnable regardless of what prior runs left behind.
    await resetStock(manager, product.id, 10);

    const orderBody = JSON.stringify({
      items: [{ productId: product.id, quantity: 1 }],
    });

    // --- the main proof: one request, its own trace, checked three ways
    // (log, span query, this demo's own span id).
    const capture = captureStdout();
    const traceId = await tracer.startActiveSpan(
      'demo-trace place-order',
      async span => {
        try {
          const id = span.spanContext().traceId;
          const orderRes = await fetch(`${baseUrl}/orders`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'idempotency-key': `demo-trace-${id}`,
            },
            body: orderBody,
          });

          if (!orderRes.ok) {
            throw new Error(
              `POST /orders failed with status ${orderRes.status}`,
            );
          }

          return id;
        } finally {
          span.end();
        }
      },
    );
    capture.stop();

    const { parsed } = parseJsonLines<{ trace_id?: string }>(capture.lines);
    const traceMatchesLog = parsed.some(line => line.trace_id === traceId)
      ? 1
      : 0;

    const spans = await fetchTrace(traceId);
    const spanIds = new Set(spans.map(span => span.spanId));
    const orphanSpans = spans.filter(span => isOrphan(span, spanIds)).length;

    console.log(`spans=${spans.length}`);
    console.log(`orphan-spans=${orphanSpans}`);
    console.log(`trace-matches-header=${spans.length > 0 ? 1 : 0}`);
    console.log(`trace-matches-log=${traceMatchesLog}`);

    if (spans.length < 2) failures.push(`spans=${spans.length} (<2)`);
    if (orphanSpans !== 0) failures.push(`orphan-spans=${orphanSpans}`);
    if (spans.length === 0) failures.push('trace-matches-header=0');
    if (traceMatchesLog !== 1) failures.push('trace-matches-log=0');

    // --- span-status-error: forces a real 500 (not a validation 400) via
    // checkout.ts's existing DEMO_FAIL_AFTER_OUTBOX hook (the same one
    // demo-crash-write.ts already exercises directly).
    process.env.DEMO_FAIL_AFTER_OUTBOX = '1';
    const errorRequest = await tracer.startActiveSpan(
      'demo-trace force-fail',
      async span => {
        try {
          const id = span.spanContext().traceId;
          const res = await fetch(`${baseUrl}/orders`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'idempotency-key': `demo-trace-fail-${id}`,
            },
            body: orderBody,
          });

          return { traceId: id, status: res.status };
        } finally {
          span.end();
        }
      },
    );
    delete process.env.DEMO_FAIL_AFTER_OUTBOX;

    if (errorRequest.status < 500) {
      throw new Error(
        `expected a 5xx from the forced-failure request, got ${errorRequest.status}`,
      );
    }

    const errorSpans = await fetchTrace(errorRequest.traceId);
    const spanStatusError = errorSpans.some(
      span => span.status?.code === 'STATUS_CODE_ERROR',
    )
      ? 1
      : 0;

    console.log(`span-status-error=${spanStatusError}`);

    if (spanStatusError !== 1) failures.push('span-status-error=0');
  } finally {
    await close();
  }

  if (failures.length > 0) {
    console.error(`demo:trace FAILED: ${failures.join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
