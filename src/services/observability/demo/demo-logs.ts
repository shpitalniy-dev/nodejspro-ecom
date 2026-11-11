import 'reflect-metadata';

import { trace } from '@opentelemetry/api';
import { randomUUID } from 'node:crypto';

import {
  DEMO_BUYER_EMAIL,
  startDemoApp,
} from '../../../controllers/auth/demo/demo.utils.ts';
import { Product } from '../../../entities/product.entity.ts';
import { DataSourceService } from '../../data-source.service.ts';

import { captureStdout, parseJsonLines, resetStock } from './demo-utils.ts';

// demo:logs — HW #29 (a). Proves the correlator lives in request context,
// not in function arguments: three real layers (controller -> service ->
// checkout) share one trace_id for one request; eight concurrent requests
// each keep their own, distinct trace_id (ALS/OTel context isolation under
// real concurrency); and a request carrying a bearer token + a password is
// logged (so an operator can see "a request happened here") without either
// secret ever reaching the captured text.
interface LogLine {
  layer?: string;
  trace_id?: string;
  req?: { url?: string; headers?: Record<string, string> };
  body?: Record<string, unknown>;
  [key: string]: unknown;
}

async function main(): Promise<void> {
  const { app, baseUrl, close } = await startDemoApp();
  const failures: string[] = [];

  try {
    const manager = await app.get(DataSourceService).getManager();
    const [product] = await manager.getRepository(Product).find({ take: 1 });

    if (!product) {
      throw new Error(
        'demo:logs needs a seeded product — run npm run seed first',
      );
    }

    // One real order is placed below, spending real stock — reset first
    // so this is rerunnable regardless of what prior runs left behind.
    await resetStock(manager, product.id, 10);

    // --- layers + distinct-trace-ids + non-json-lines: one real request,
    // controller -> service -> checkout each tag their own line with
    // `layer`, all sharing the one trace OTel assigned this request.
    const layersRun = captureStdout();
    const orderRes = await fetch(`${baseUrl}/orders`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': `demo-logs-${randomUUID()}`,
      },
      body: JSON.stringify({ items: [{ productId: product.id, quantity: 1 }] }),
    });
    layersRun.stop();

    if (!orderRes.ok) {
      throw new Error(`POST /orders failed with status ${orderRes.status}`);
    }

    const { parsed: layersLines, nonJsonLines } = parseJsonLines<LogLine>(
      layersRun.lines,
    );
    const layerValues = new Set(
      layersLines
        .map(line => line.layer)
        .filter((l): l is string => Boolean(l)),
    );
    const distinctTraceIds = new Set(
      layersLines.map(line => line.trace_id).filter(Boolean),
    ).size;

    console.log(`non-json-lines=${nonJsonLines}`);
    console.log(`layers=${layerValues.size}`);
    console.log(`distinct-trace-ids=${distinctTraceIds}`);

    if (nonJsonLines !== 0) failures.push(`non-json-lines=${nonJsonLines}`);
    if (layerValues.size < 3) failures.push(`layers=${layerValues.size} (<3)`);

    if (distinctTraceIds !== 1) {
      failures.push(`distinct-trace-ids=${distinctTraceIds}`);
    }

    // --- burst: eight concurrent requests, each under its own real OTel
    // span — proves correlation holds under real concurrency, not just "a
    // single request works." A "current request" bug living in a
    // module-level variable instead of context would show up here as
    // lines landing under the wrong trace_id (burst-uneven > 0) or the
    // span's own trace id not matching what the logs recorded
    // (trace-id-matches-header=0) — never as a thrown error, which is
    // exactly why this needs its own dedicated check.
    const tracer = trace.getTracer('demo-logs');

    const burstRun = captureStdout();
    const burstSpanTraceIds = await Promise.all(
      Array.from({ length: 8 }, () =>
        tracer.startActiveSpan('demo-logs burst', async span => {
          try {
            await fetch(`${baseUrl}/health`);

            return span.spanContext().traceId;
          } finally {
            span.end();
          }
        }),
      ),
    );
    burstRun.stop();

    const { parsed: burstLines } = parseJsonLines<LogLine>(burstRun.lines);
    const burstGroups = new Map<string, number>();

    for (const line of burstLines) {
      if (!line.trace_id) continue;
      burstGroups.set(line.trace_id, (burstGroups.get(line.trace_id) ?? 0) + 1);
    }

    const burst = burstSpanTraceIds.length;
    const burstTraceIds = burstGroups.size;
    const groupSizes = [...burstGroups.values()];
    const expectedPerGroup = burstLines.length / (burstTraceIds || 1);
    const burstUneven = groupSizes.filter(
      size => size !== expectedPerGroup,
    ).length;
    const traceIdMatchesHeader = burstSpanTraceIds.every(id =>
      burstGroups.has(id),
    )
      ? 1
      : 0;

    console.log(`burst=${burst}`);
    console.log(`burst-trace-ids=${burstTraceIds}`);
    console.log(`burst-uneven=${burstUneven}`);
    console.log(`trace-id-matches-header=${traceIdMatchesHeader}`);

    if (burstTraceIds !== burst) {
      failures.push(`burst-trace-ids=${burstTraceIds} (expected ${burst})`);
    }

    if (burstUneven !== 0) failures.push(`burst-uneven=${burstUneven}`);
    if (traceIdMatchesHeader !== 1) failures.push('trace-id-matches-header=0');

    // --- secrets: a request carrying both an Authorization bearer token
    // and a password must be logged (operators need to see it happened)
    // without either value surviving redaction.
    const secretToken = `demo-token-${randomUUID()}`;
    const secretPassword = `demo-password-${randomUUID()}`;

    const secretRun = captureStdout();
    await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${secretToken}`,
      },
      body: JSON.stringify({
        email: DEMO_BUYER_EMAIL,
        password: secretPassword,
      }),
    });
    secretRun.stop();

    const { parsed: secretLines } = parseJsonLines<LogLine>(secretRun.lines);
    const secretReqLogged = secretLines.some(
      line => line.req?.url === '/auth/login',
    )
      ? 1
      : 0;
    const rawSecretText = secretRun.lines.join('\n');
    const secretInLogs =
      rawSecretText.includes(secretToken) ||
      rawSecretText.includes(secretPassword)
        ? 1
        : 0;

    console.log(`secret-req-logged=${secretReqLogged}`);
    console.log(`secret-in-logs=${secretInLogs}`);

    if (secretReqLogged !== 1) failures.push('secret-req-logged=0');
    if (secretInLogs !== 0) failures.push(`secret-in-logs=${secretInLogs}`);
  } finally {
    await close();
  }

  if (failures.length > 0) {
    console.error(`demo:logs FAILED: ${failures.join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
