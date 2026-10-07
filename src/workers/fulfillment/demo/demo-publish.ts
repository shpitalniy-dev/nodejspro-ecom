import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';

import { OrderEventPublisher } from '../../../controllers/orders/orders.publisher.ts';
import { dataSourceOptions } from '../../../data-source.ts';
import { connectBroker } from '../../../services/rabbitmq/rabbitmq.connection.ts';
import { DLQ, QUEUE } from '../../../services/rabbitmq/rabbitmq.topology.ts';
import { requireEnv } from '../../../utils/require-env.ts';
import { waitUntil } from '../../../utils/wait-until.ts';
import { PREFETCH } from '../fulfillment.worker.ts';

import {
  countFulfillments,
  DemoPublisherModule,
  publishOrders,
  resetBroker,
  resetDemoFixtures,
  startFulfillmentWorker,
} from './demo.utils.ts';

// demo:publish: five real orders through checkout() and the real publisher,
// consumed by the real fulfilment worker process. Prints key=value lines and
// checks its own invariant.

const PUBLISH_COUNT = 5;
const STOCK = 10;

async function main(): Promise<void> {
  const dbUrl = new URL(requireEnv('DB_URL'));
  const brokerUrl = requireEnv('BROKER_URL');

  const admin = await new DataSource(dataSourceOptions).initialize();
  const app = await NestFactory.createApplicationContext(DemoPublisherModule, {
    logger: false,
  });

  // Reset first: the worker must bind to the freshly declared queue, not to
  // one a later reset deletes under it.
  await resetBroker(brokerUrl);

  const worker = await startFulfillmentWorker(dbUrl, brokerUrl);

  try {
    const buyerId = await resetDemoFixtures(admin, STOCK);
    const orderIds = await publishOrders(
      admin,
      app.get(OrderEventPublisher),
      buyerId,
      PUBLISH_COUNT,
    );

    await waitUntil(
      async () =>
        (await countFulfillments(admin, orderIds)) === orderIds.length &&
        worker.log.acked >= orderIds.length,
      30_000,
    );

    const applied = await countFulfillments(admin, orderIds);
    const connection = await connectBroker(brokerUrl);
    const channel = await connection.createChannel();
    const work = (await channel.checkQueue(QUEUE)).messageCount;
    const dlq = (await channel.checkQueue(DLQ)).messageCount;

    await connection.close();

    const published = orderIds.length;
    const invariantOk =
      published === PUBLISH_COUNT &&
      applied === PUBLISH_COUNT &&
      dlq === 0 &&
      work === 0 &&
      PREFETCH >= 1 &&
      PREFETCH <= 2000;

    console.log(`demo:publish — ${PUBLISH_COUNT} orders, one worker process`);
    console.log(`published=${published}`);
    console.log(`delivered=${worker.log.delivered}`);
    console.log(`effect=${applied}`);
    console.log(`acked=${worker.log.acked}`);
    console.log(`dlq=${dlq}`);
    console.log(`work=${work}`);
    console.log(`prefetch=${PREFETCH}`);

    if (invariantOk) {
      console.log(
        'invariant check passed — every published event applied once, nothing in DLQ',
      );
    } else {
      console.error('invariant check FAILED');
      process.exitCode = 1;
    }
  } finally {
    await worker.stop();
    await app.close();
    await admin.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
