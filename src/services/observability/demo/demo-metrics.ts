import 'reflect-metadata';

import { startDemoApp } from '../../../controllers/auth/demo/demo.utils.ts';
import { Product } from '../../../entities/product.entity.ts';
import { DataSourceService } from '../../data-source.service.ts';
import { DURATION_BUCKETS, registry } from '../metrics.ts';

import { resetStock } from './demo-utils.ts';

// demo:metrics — HW #29 (b). Two independent claims:
// 1. errors-delta counts real server errors (5xx), not client mistakes
//    (4xx) — forced via checkout.ts's DEMO_FAIL_AFTER_OUTBOX hook, the same
//    sanctioned demo-only failure path demo-trace.ts already uses, so this
//    is a genuine unhandled exception traveling the real code path, not a
//    mocked status.
// 2. the label set is bounded: a hundred different product ids in the
//    PATH (GET /products/:productId — a real route param, unlike a header,
//    which Express's router never looks at) must never become a hundred
//    new time series for that route.
// Every number below is read back from the real shared `registry`
// (prom-client's own `getMetricsAsJSON()`, same object red-metrics
// .middleware.ts writes to and /metrics serves) — never printed from a
// separately-tracked in-memory guess.
const ORDERS_ROUTE = '/orders';
const PRODUCTS_ROUTE = '/products/:productId';
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

async function postOrder(
  baseUrl: string,
  body: string,
  idempotencyKey: string,
  forceFail: boolean,
): Promise<Response> {
  // DEMO_FAIL_AFTER_OUTBOX only exists for demos (checkout.ts: "Production
  // never sets this") — it throws *after* the real transaction work runs,
  // so this is a genuine unhandled exception on a real request, not a
  // forced/fake HTTP status.
  if (forceFail) process.env.DEMO_FAIL_AFTER_OUTBOX = '1';

  try {
    return await fetch(`${baseUrl}${ORDERS_ROUTE}`, {
      method: METHOD,
      headers: {
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body,
    });
  } finally {
    if (forceFail) delete process.env.DEMO_FAIL_AFTER_OUTBOX;
  }
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

    // Warm /orders with both outcomes, and /products/:productId with both
    // outcomes too (200 for a real id, 404 for the ids the loop below
    // actually uses), before either series-before — otherwise whichever
    // status this demo hasn't produced yet would itself look like "new
    // series" for a reason that has nothing to do with the checks below.
    await postOrder(baseUrl, validBody, 'demo-metrics-warmup-ok', false);
    await postOrder(baseUrl, validBody, 'demo-metrics-warmup-fail', true);
    await fetch(`${baseUrl}/products/${product.id}`);
    await fetch(`${baseUrl}/products/${product.id + 10_000 - 1}`);

    const ordersBefore = (await valuesOf('http_requests_total')).filter(
      s => s.labels.route === ORDERS_ROUTE,
    );
    const totalBefore = sum(ordersBefore);
    const errorsBefore = sum(
      ordersBefore.filter(s => Number(s.labels.status) >= 500),
    );

    let sentOk = 0;
    let sentFail = 0;

    for (let i = 0; i < REQUEST_COUNT; i++) {
      const ok = i % 2 === 0;
      const res = await postOrder(baseUrl, validBody, `demo-metrics-${i}`, !ok);

      if (res.ok) sentOk++;
      else sentFail++;
    }

    const ordersAfter = (await valuesOf('http_requests_total')).filter(
      s => s.labels.route === ORDERS_ROUTE,
    );
    const totalAfter = sum(ordersAfter);
    const errorsAfter = sum(
      ordersAfter.filter(s => Number(s.labels.status) >= 500),
    );

    const counterDelta = totalAfter - totalBefore;
    const errorsDelta = errorsAfter - errorsBefore;

    const topBucket = String(DURATION_BUCKETS[DURATION_BUCKETS.length - 1]);
    const durationValues = await valuesOf('http_request_duration_seconds');
    const durationCount = find(
      durationValues,
      { method: METHOD, route: ORDERS_ROUTE },
      'http_request_duration_seconds_count',
    );
    const durationTopBucket = find(
      durationValues,
      { method: METHOD, route: ORDERS_ROUTE, le: topBucket },
      'http_request_duration_seconds_bucket',
    );
    const aboveTopBucket = durationCount - durationTopBucket;

    // --- cardinality: 100 distinct product ids in the PATH, not a header ---
    const seriesBefore = (await valuesOf('http_requests_total')).filter(
      s => s.labels.route === PRODUCTS_ROUTE,
    ).length;

    for (let i = 0; i < REQUEST_COUNT; i++) {
      // Need not exist — a 404 is fine, only the route *label* is checked.
      await fetch(`${baseUrl}/products/${product.id + 10_000 + i}`);
    }

    const seriesAfter = (await valuesOf('http_requests_total')).filter(
      s => s.labels.route === PRODUCTS_ROUTE,
    ).length;

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
