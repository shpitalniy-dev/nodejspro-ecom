import type { ConfirmChannel } from 'amqplib';
import { randomUUID } from 'node:crypto';

import { connectBroker } from '../../../services/rabbitmq/rabbitmq.connection.ts';
import {
  DLQ,
  EXCHANGE,
  QUEUE,
  ROUTING_KEY,
} from '../../../services/rabbitmq/rabbitmq.topology.ts';
import { requireEnv } from '../../../utils/require-env.ts';
import { waitUntil } from '../../../utils/wait-until.ts';

import { resetBroker, startFulfillmentWorker } from './demo.utils.ts';

// demo:dlq: one poison message (not an order.placed) must end up in the DLQ
// with a readable reason, and must not block the work queue or apply an effect.
//
// The poison is published raw, bypassing OrderEventPublisher on purpose: the
// typed publisher can only send valid events.

const DEAD_LETTER_REASONS = [
  'rejected',
  'expired',
  'maxlen',
  'delivery_limit',
] as const;

const POISON = Buffer.from(JSON.stringify({ not: 'an order.placed' }));

interface DeathEntry {
  reason?: string;
}

// Reads the death reason without consuming the dead letter: get, read the
// headers, then nack with requeue so the DLQ still holds the message.
async function peekDeathReason(
  channel: ConfirmChannel,
): Promise<string | undefined> {
  const message = await channel.get(DLQ, { noAck: false });

  if (!message) {
    return undefined;
  }

  const headers = message.properties.headers ?? {};
  const deaths = headers['x-death'] as DeathEntry[] | undefined;
  const reason =
    (headers['x-first-death-reason'] as string | undefined) ??
    deaths?.[0]?.reason;

  channel.nack(message, false, true);

  return reason;
}

async function main(): Promise<void> {
  const dbUrl = new URL(requireEnv('DB_URL'));
  const brokerUrl = requireEnv('BROKER_URL');

  // Reset first, then start the worker on the fresh queue.
  await resetBroker(brokerUrl);

  const worker = await startFulfillmentWorker(dbUrl, brokerUrl);
  const connection = await connectBroker(brokerUrl);

  try {
    // 1. Publish the poison through a confirm channel and wait for the broker.
    const channel = await connection.createConfirmChannel();

    channel.publish(EXCHANGE, ROUTING_KEY, POISON, {
      persistent: true,
      contentType: 'application/json',
      messageId: randomUUID(),
    });

    await channel.waitForConfirms();

    // 2. Wait until the worker has rejected it and it sits in the DLQ.
    await waitUntil(async () => {
      const dlq = (await channel.checkQueue(DLQ)).messageCount;
      const work = (await channel.checkQueue(QUEUE)).messageCount;

      return dlq === 1 && work === 0 && worker.log.rejected >= 1;
    }, 20_000);

    // 3. Measure the end state and read the reason from the dead letter.
    const work = (await channel.checkQueue(QUEUE)).messageCount;
    const dlq = (await channel.checkQueue(DLQ)).messageCount;
    const reason = dlq === 1 ? await peekDeathReason(channel) : undefined;
    const effect = worker.log.acked;

    const reasonOk =
      reason !== undefined &&
      (DEAD_LETTER_REASONS as readonly string[]).includes(reason);
    const invariantOk = work === 0 && dlq === 1 && reasonOk && effect === 0;

    console.log('demo:dlq — one poison message, one worker process');
    console.log(`rejected=${worker.log.rejected}`);
    console.log(`work=${work}`);
    console.log(`dlq=${dlq}`);
    console.log(`dlq-reason=${reason ?? 'none'}`);
    console.log(`effect=${effect}`);

    if (invariantOk) {
      console.log(
        `invariant check passed — the poison message is in the DLQ with reason ${reason}`,
      );
    } else {
      console.error('invariant check FAILED');
      process.exitCode = 1;
    }
  } finally {
    await connection.close();
    await worker.stop();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
