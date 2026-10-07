import { connectBroker } from '../../src/services/rabbitmq/rabbitmq.connection.ts';
import {
  declareTopology,
  EXCHANGE,
  QUEUE,
  ROUTING_KEY,
  UNROUTABLE_QUEUE,
} from '../../src/services/rabbitmq/rabbitmq.topology.ts';

import type { TestBroker } from './testkit/rabbitmq-container.ts';
import { startTestRabbitMQ } from './testkit/rabbitmq-container.ts';

// The topology, against a real RabbitMQ. Covers the one behaviour the demos
// do not: a routing key with no binding must land in the alternate exchange's
// queue, not vanish under a positive confirm.
describe('RabbitMQ topology (testcontainers, real rabbitmq:4.2-management)', () => {
  let broker: TestBroker;

  beforeAll(async () => {
    broker = await startTestRabbitMQ();
  }, 120000);

  afterAll(async () => {
    await broker.stop();
  });

  test('declareTopology is idempotent: a second declaration does not throw', async () => {
    const connection = await connectBroker(broker.url);

    try {
      const channel = await connection.createChannel();

      await declareTopology(channel);
      await declareTopology(channel);
    } finally {
      await connection.close();
    }
  });

  test('a routing key with no binding goes to the unroutable queue, not nowhere', async () => {
    const connection = await connectBroker(broker.url);

    try {
      const channel = await connection.createConfirmChannel();

      await declareTopology(channel);
      channel.publish(EXCHANGE, 'nothing.bound.here', Buffer.from('{}'));
      // The broker confirms even an unroutable message, which is the trap.
      await channel.waitForConfirms();

      const message = await channel.get(UNROUTABLE_QUEUE, { noAck: true });

      expect(message).not.toBe(false);
      expect(message && message.fields.routingKey).toBe('nothing.bound.here');
    } finally {
      await connection.close();
    }
  });

  test('order.placed reaches the work queue and nothing lands in the unroutable one', async () => {
    const connection = await connectBroker(broker.url);

    try {
      const channel = await connection.createConfirmChannel();

      await declareTopology(channel);
      channel.publish(EXCHANGE, ROUTING_KEY, Buffer.from('{}'));
      await channel.waitForConfirms();

      expect((await channel.checkQueue(QUEUE)).messageCount).toBe(1);
      expect((await channel.checkQueue(UNROUTABLE_QUEUE)).messageCount).toBe(0);
    } finally {
      await connection.close();
    }
  });
});
