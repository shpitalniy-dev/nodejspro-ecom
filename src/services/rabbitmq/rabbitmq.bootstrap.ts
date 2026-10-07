import { connectBroker } from './rabbitmq.connection.ts';
import { declareTopology } from './rabbitmq.topology.ts';

// One-shot: declares the exchanges, queues and bindings, then exits. Compose
// runs it before api and the worker start, so a publish never lands on a
// missing exchange. The broker answers that with 404 and closes the channel,
// which would lose the event. Idempotent, so it is safe on every `up`.
async function main(): Promise<void> {
  const brokerUrl = process.env.BROKER_URL;

  if (!brokerUrl) {
    throw new Error('BROKER_URL is not set');
  }

  const connection = await connectBroker(brokerUrl);

  try {
    await declareTopology(await connection.createChannel());
    console.log('[rabbitmq-topology] declared');
  } finally {
    await connection.close();
  }
}

main().catch((error: unknown) => {
  console.error('[rabbitmq-topology] failed', error);
  process.exitCode = 1;
});
