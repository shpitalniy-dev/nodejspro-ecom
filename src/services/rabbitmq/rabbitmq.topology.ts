import type { Channel } from 'amqplib';

export const EXCHANGE = 'shop.events';
export const ROUTING_KEY = 'order.placed';
export const QUEUE = 'fulfilment.order-placed';

export const DLX = 'shop.dlx';
export const DLQ = 'fulfilment.order-placed.dlq';

export const UNROUTABLE_EXCHANGE = 'shop.unroutable';
export const UNROUTABLE_QUEUE = 'shop.unroutable';

const QUORUM = { 'x-queue-type': 'quorum' } as const;

// After this many transient redeliveries the broker dead-letters the
// message with reason `delivery_limit`.
const DELIVERY_LIMIT = 5;

// Idempotent for the same arguments. Changing arguments later gives 406
// PRECONDITION_FAILED, which is why resetTopology deletes and redeclares.
export async function declareTopology(ch: Channel): Promise<void> {
  // Dead-letter circuit
  await ch.assertExchange(DLX, 'direct', { durable: true });
  await ch.assertQueue(DLQ, { durable: true, arguments: QUORUM });
  await ch.bindQueue(DLQ, DLX, ROUTING_KEY);

  // Unroutable circuit
  await ch.assertExchange(UNROUTABLE_EXCHANGE, 'fanout', { durable: true });
  await ch.assertQueue(UNROUTABLE_QUEUE, { durable: true, arguments: QUORUM });
  await ch.bindQueue(UNROUTABLE_QUEUE, UNROUTABLE_EXCHANGE, '');

  // Domain exchange, work queue, binding
  await ch.assertExchange(EXCHANGE, 'topic', {
    durable: true,
    arguments: { 'alternate-exchange': UNROUTABLE_EXCHANGE },
  });
  await ch.assertQueue(QUEUE, {
    durable: true,
    arguments: {
      ...QUORUM,
      'x-dead-letter-exchange': DLX,
      'x-delivery-limit': DELIVERY_LIMIT,
    },
  });
  await ch.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);
}

// Demo and test reset only.
export async function resetTopology(ch: Channel): Promise<void> {
  for (const queue of [QUEUE, DLQ, UNROUTABLE_QUEUE]) {
    await ch.deleteQueue(queue);
  }

  for (const exchange of [EXCHANGE, DLX, UNROUTABLE_EXCHANGE]) {
    await ch.deleteExchange(exchange);
  }
}
