import 'reflect-metadata';

import { startDemoApp } from '../../../controllers/auth/demo/demo.utils.ts';
import { Product } from '../../../entities/product.entity.ts';
import { DataSourceService } from '../../data-source.service.ts';
import { DURATION_BUCKETS, registry } from '../metrics.ts';

import { resetStock } from './demo-utils.ts';

// demo:metrics — HW #29 (b). Proves the label set is bounded: a hundred
// different Idempotency-Key values (a real, per-request identifier this
// app already has, HW #22) must never become a hundred new time series.
// Every number below is read back from the real shared `registry`
// (prom-client's own `getMetricsAsJSON()`, same object red-metrics
// .middleware.ts writes to and /metrics serves) — never printed from a
// separately-tracked in-memory guess.
const ROUTE = '/orders';
const METHOD = 'POST';
const REQUEST_COUNT = 100; // ≥ 50 required; also the "100 distinct ids" check

// prom-client's own type for getMetricsAsJSON() omits `metricName`, but a
// Histogram's values carry one at runtime (histogram.js's splayLabels) to
// tell its `_bucket`/`_sum`/`_count` rows apart — a Counter's values don't
// need it, since it only ever has one exported name.
interface Sample {
  value: number;
  labels: Record<string, string | number | undefined>;
  metricName?: string;
}

async function valuesOf(metricName: string): Promise<Sample[]> {
  const metrics = await registry.getMetricsAsJSON();

  return (metrics.find(m => m.name === metricName)?.values ?? []) as Sample[];
}

function sum(values: Sample[]): number {
  return values.reduce((total, sample) => total + sample.value, 0);
}

function find(
  values: Sample[],
  labels: Record<string, string>,
  metricName?: string,
): number {
  return (
    values.find(
      sample =>
        (metricName === undefined || sample.metricName === metricName) &&
        Object.entries(labels).every(
          ([key, val]) => String(sample.labels[key]) === val,
        ),
    )?.value ?? 0
  );
}

async function main(): Promise<void> {
  const { app, baseUrl, close } = await startDemoApp();
  const failures: string[] = [];

  try {
    const manager = await app.get(DataSourceService).getManager();
    const [product] = await manager.getRepository(Product).find({ take: 1 });

    if (!product) {
      throw new Error(
        'demo:metrics needs a seeded product — run npm run seed first',
      );
    }

    // REQUEST_COUNT/2 + 2 warmup "ok" requests spend real stock each run —
    // reset first so this is rerunnable regardless of what prior runs left.
    await resetStock(manager, product.id, REQUEST_COUNT + 50);

    const validBody = JSON.stringify({
      items: [{ productId: product.id, quantity: 1 }],
    });
    // A productId no seeded product ever uses — a real 400 from
    // OrdersService's own existing validation, not a forced/fake status.
    const invalidBody = JSON.stringify({
      items: [{ productId: 999_999_999, quantity: 1 }],
    });

    // Warm the route with BOTH outcomes once, before series-before —
    // otherwise whichever status code this route hasn't produced yet
    // (success, or the 400 the loop below also sends) would itself look
    // like "new series" in the delta, for a reason that has nothing to do
    // with the 100 distinct ids this check actually targets.
    await fetch(`${baseUrl}${ROUTE}`, {
      method: METHOD,
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'demo-metrics-warmup-ok',
      },
      body: validBody,
    });
    await fetch(`${baseUrl}${ROUTE}`, {
      method: METHOD,
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'demo-metrics-warmup-fail',
      },
      body: invalidBody,
    });

    const requestsBefore = (await valuesOf('http_requests_total')).filter(
      s => s.labels.route === ROUTE,
    );
    const seriesBefore = requestsBefore.length;
    const totalBefore = sum(requestsBefore);
    const errorsBefore = sum(
      requestsBefore.filter(s => Number(s.labels.status) >= 400),
    );

    let sentOk = 0;
    let sentFail = 0;

    for (let i = 0; i < REQUEST_COUNT; i++) {
      const ok = i % 2 === 0;
      const res = await fetch(`${baseUrl}${ROUTE}`, {
        method: METHOD,
        headers: {
          'content-type': 'application/json',
          // 100 distinct ids — must never leak into a metric label.
          'idempotency-key': `demo-metrics-${i}`,
        },
        body: ok ? validBody : invalidBody,
      });

      if (res.ok) sentOk++;
      else sentFail++;
    }

    const requestsAfter = (await valuesOf('http_requests_total')).filter(
      s => s.labels.route === ROUTE,
    );
    const seriesAfter = requestsAfter.length;
    const totalAfter = sum(requestsAfter);
    const errorsAfter = sum(
      requestsAfter.filter(s => Number(s.labels.status) >= 400),
    );

    const counterDelta = totalAfter - totalBefore;
    const errorsDelta = errorsAfter - errorsBefore;

    const topBucket = String(DURATION_BUCKETS[DURATION_BUCKETS.length - 1]);
    const durationValues = await valuesOf('http_request_duration_seconds');
    const durationCount = find(
      durationValues,
      { method: METHOD, route: ROUTE },
      'http_request_duration_seconds_count',
    );
    const durationTopBucket = find(
      durationValues,
      { method: METHOD, route: ROUTE, le: topBucket },
      'http_request_duration_seconds_bucket',
    );
    const aboveTopBucket = durationCount - durationTopBucket;

    console.log(`sent-ok=${sentOk}`);
    console.log(`sent-fail=${sentFail}`);
    console.log(`counter-delta=${counterDelta}`);
    console.log(`errors-delta=${errorsDelta}`);
    console.log(`above-top-bucket=${aboveTopBucket}`);
    console.log(`series-before=${seriesBefore}`);
    console.log(`series-after=${seriesAfter}`);

    if (sentOk + sentFail < 50) {
      failures.push(`sent-ok+sent-fail=${sentOk + sentFail} (<50)`);
    }

    if (counterDelta !== sentOk + sentFail) {
      failures.push(
        `counter-delta=${counterDelta} (expected ${sentOk + sentFail})`,
      );
    }

    if (errorsDelta !== sentFail) {
      failures.push(`errors-delta=${errorsDelta} (expected ${sentFail})`);
    }

    if (aboveTopBucket !== 0) {
      failures.push(`above-top-bucket=${aboveTopBucket}`);
    }

    if (seriesAfter !== seriesBefore) {
      failures.push(`series-after=${seriesAfter} (expected ${seriesBefore})`);
    }
  } finally {
    await close();
  }

  if (failures.length > 0) {
    console.error(`demo:metrics FAILED: ${failures.join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
