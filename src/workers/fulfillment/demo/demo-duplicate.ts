import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';

import { OrderEventPublisher } from '../../../controllers/orders/orders.publisher.ts';
import { dataSourceOptions } from '../../../data-source.ts';
import { connectBroker } from '../../../services/rabbitmq/rabbitmq.connection.ts';
import { QUEUE } from '../../../services/rabbitmq/rabbitmq.topology.ts';
import { requireEnv } from '../../../utils/require-env.ts';
import { waitUntil } from '../../../utils/wait-until.ts';

import {
  countFulfillments,
  DemoPublisherModule,
  publishOrders,
  resetBroker,
  resetDemoFixtures,
  RunningWorker,
  startFulfillmentWorker,
} from './demo.utils.ts';

// demo:duplicate: the same order.placed is delivered twice, and its effect is
// applied once.
//
// The first worker applies the effect, then SIGKILLs itself before the ack.
// That's the crash window: the row is committed, the broker never got the ack.
// The broker sees the dropped connection and redelivers the message. The second
// worker sees redelivered=true, the INSERT ... ON CONFLICT DO NOTHING reports
// a duplicate, and it acks. Two deliveries, one effect.
//
// The crash is a real process death (SIGKILL), not channel.close(), which
// would be a graceful shutdown.

const STOCK = 10;

async function main(): Promise<void> {
  const dbUrl = new URL(requireEnv('DB_URL'));
  const brokerUrl = requireEnv('BROKER_URL');

  const dataSource = await new DataSource(dataSourceOptions).initialize();
  const app = await NestFactory.createApplicationContext(DemoPublisherModule, {
    logger: false,
  });

  // Reset first, so the workers bind to a fresh queue.
  await resetBroker(brokerUrl);

  const crashing = await startFulfillmentWorker(dbUrl, brokerUrl, {
    DEMO_CRASH_AFTER_EFFECT: '1',
  });

  let recovering: RunningWorker | null = null;

  try {
    const buyerId = await resetDemoFixtures(dataSource, STOCK);

    const orderEventPublisher = app.get(OrderEventPublisher);
    const [orderId] = await publishOrders(
      dataSource,
      orderEventPublisher,
      buyerId,
      1,
    );

    // 1. The first worker dies by SIGKILL right after the effect commits.
    const { signal } = await crashing.exited;

    // 2. A normal worker starts and gets the redelivered message.
    const second = await startFulfillmentWorker(dbUrl, brokerUrl);

    recovering = second;
    await waitUntil(async () => second.log.acked >= 1, 20_000);

    // 3. Measure the end state.
    const deliveries = crashing.log.delivered + second.log.delivered;
    const effect = await countFulfillments(dataSource, [orderId]);
    const skipped = second.log.skipped;

    const connection = await connectBroker(brokerUrl);
    const channel = await connection.createChannel();
    const work = (await channel.checkQueue(QUEUE)).messageCount;

    await connection.close();

    const invariantOk =
      signal === 'SIGKILL' &&
      deliveries >= 2 &&
      effect === 1 &&
      skipped === 1 &&
      work === 0;

    console.log('demo:duplicate — one order, one worker killed mid-flight');
    console.log(`crash=${signal ?? 'none'}`);
    console.log(`deliveries=${deliveries}`);
    console.log(`effect=${effect}`);
    console.log(`skipped=${skipped}`);
    console.log(`work=${work}`);

    if (invariantOk) {
      console.log(
        'invariant check passed — two deliveries, one effect, the duplicate was skipped',
      );
    } else {
      console.error('invariant check FAILED');
      process.exitCode = 1;
    }
  } finally {
    await crashing.stop();
    await recovering?.stop();
    await app.close();
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
