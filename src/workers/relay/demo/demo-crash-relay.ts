import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';

import { dataSourceOptions } from '../../../data-source.ts';
import { checkout } from '../../../transactions/checkout.ts';
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
  countProcessedMessages,
  DemoRelayModule,
  getOutboxEventId,
  resetStaleOutboxRows,
} from './demo.utils.ts';

const STOCK = 10;

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
  const buyerId = await resetDemoFixtures(admin, STOCK);

  const worker = await startFulfillmentWorker(dbUrl, brokerUrl);

  try {
    const { orderId } = await checkout(admin, {
      userId: buyerId,
      items: [{ productKey: DEMO_PRODUCT_KEY, quantity: 1 }],
    });

    // Delivery #1: publish succeeds (the broker now has the message), then
    // the crash hits before the UPDATE. The transaction this ran inside
    // rolls back, so published_at stays NULL for this row.
    process.env.DEMO_CRASH_AFTER_PUBLISH = '1';
    await relayService.relayBatch(admin.manager, 1).catch(() => undefined);
    delete process.env.DEMO_CRASH_AFTER_PUBLISH;

    await waitUntil(async () => worker.log.acked >= 1, 20_000);

    // Delivery #2: a normal pass claims the SAME still-unpublished row and
    // republishes it for real — a second, independent broker message
    // carrying the same eventId.
    const secondBatchClaimed = await relayService.relayBatch(admin.manager, 1);

    await waitUntil(async () => worker.log.acked >= 2, 20_000);

    const eventId = await getOutboxEventId(admin, orderId);

    if (!eventId) {
      throw new Error(`outbox row for order ${orderId} vanished`);
    }

    const deliveries = worker.log.delivered;
    const published = deliveries;
    const applied = worker.log.acked - worker.log.skipped;
    const effect = await countFulfillments(admin, [orderId]);
    const processed = await countProcessedMessages(admin, eventId);

    const invariantOk =
      deliveries >= 2 &&
      secondBatchClaimed === 1 &&
      applied === 1 &&
      effect === 1 &&
      processed === 1;

    console.log(
      'demo:crash-relay — relay crashes between publish and UPDATE published_at',
    );
    console.log(`published=${published}`);
    console.log(`deliveries=${deliveries}`);
    console.log(`applied=${applied}`);
    console.log(`effect=${effect}`);
    console.log(`processed=${processed}`);

    if (invariantOk) {
      console.log(
        'invariant check passed — delivered at least twice, applied exactly once',
      );
    } else {
      console.error('invariant check FAILED');
      process.exitCode = 1;
    }
  } finally {
    await worker.stop();
    await relayApp.close();
    await admin.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
