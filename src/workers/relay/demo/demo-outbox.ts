import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { dataSourceOptions } from '../../../data-source.ts';
import { Product } from '../../../entities/product.entity.ts';
import { requireEnv } from '../../../utils/require-env.ts';
import { waitUntil } from '../../../utils/wait-until.ts';
import {
  countFulfillments,
  DEMO_PRODUCT_KEY,
  resetBroker,
  resetDemoFixtures,
  startFulfillmentWorker,
} from '../../fulfillment/demo/demo.utils.ts';
import { RelayService } from '../relay.service.ts';

import {
  countOutboxRows,
  countProcessedMessages,
  DemoRelayModule,
  getOutboxEventId,
  resetStaleOutboxRows,
  startDemoApiApp,
} from './demo.utils.ts';

const STOCK = 10;
const IDEMPOTENCY_KEY = 'demo-outbox-idempotency-key';
const RELAY_BATCH_SIZE = 10;

async function main(): Promise<void> {
  const dbUrl = new URL(requireEnv('DB_URL'));
  const brokerUrl = requireEnv('BROKER_URL');

  const admin = await new DataSource(dataSourceOptions).initialize();
  const relayApp = await NestFactory.createApplicationContext(DemoRelayModule, {
    logger: false,
  });
  const relayService = relayApp.get(RelayService);

  await resetBroker(brokerUrl);
  await resetStaleOutboxRows(admin);
  await resetDemoFixtures(admin, STOCK);

  const product = await admin
    .getRepository(Product)
    .findOneByOrFail({ key: DEMO_PRODUCT_KEY });

  const worker = await startFulfillmentWorker(dbUrl, brokerUrl);
  const api = await startDemoApiApp(dbUrl);

  try {
    const body = { items: [{ productId: product.id, quantity: 1 }] };

    // Request 1: creates the order (checkout() commits it, with the outbox
    // row, in one transaction — no publish() here, see checkout.ts).
    const first = await request(api.app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send(body)
      .expect(201);

    // Request 2: same Idempotency-Key — IdempotencyKeyInterceptor replays
    // request 1's cached response instead of running checkout() again.
    const second = await request(api.app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send(body);

    const requests = 2;
    const orderId = first.body.id as number;
    const replayedSameOrder =
      second.body.id === orderId &&
      second.headers['idempotency-replay'] === 'true';

    // Relay: one pass is enough — checkout()'s transaction (and so the
    // outbox row) already committed before request 1 resolved.
    await relayService.relayBatch(admin.manager, RELAY_BATCH_SIZE);

    await waitUntil(async () => worker.log.acked >= 1, 20_000);

    const orders = (
      await admin.query('SELECT 1 FROM orders WHERE id = $1', [orderId])
    ).length;
    const outbox = await countOutboxRows(admin, orderId);
    const published = await countOutboxRows(admin, orderId, {
      publishedOnly: true,
    });
    const deliveries = worker.log.delivered;
    const effect = await countFulfillments(admin, [orderId]);
    const eventId = await getOutboxEventId(admin, orderId);
    const processed = eventId
      ? await countProcessedMessages(admin, eventId)
      : 0;

    const invariantOk =
      requests === 2 &&
      replayedSameOrder &&
      orders === 1 &&
      outbox === 1 &&
      published === 1 &&
      deliveries === 1 &&
      effect === 1 &&
      processed === 1;

    console.log('demo:outbox — two requests, one Idempotency-Key, one order');
    console.log(`requests=${requests}`);
    console.log(`orders=${orders}`);
    console.log(`outbox=${outbox}`);
    console.log(`published=${published}`);
    console.log(`deliveries=${deliveries}`);
    console.log(`effect=${effect}`);
    console.log(`processed=${processed}`);

    if (invariantOk) {
      console.log(
        'invariant check passed — one order, one outbox row, one delivery, one effect',
      );
    } else {
      console.error('invariant check FAILED');
      process.exitCode = 1;
    }
  } finally {
    await worker.stop();
    await api.close();
    await relayApp.close();
    await admin.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
