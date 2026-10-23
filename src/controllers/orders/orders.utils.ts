import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { Order as OrderEntity } from '../../entities/order.entity.ts';
import type { Currency } from '../../types/index.ts';

import { OrderStatusEvent } from './order-events.service.ts';
import type {
  Order,
  OrderPlacedEvent,
  OrderPlacedSource,
  OrderStatusChangedEvent,
  OrderStatusChangedSource,
} from './orders.types.ts';

// user: true added for HW#18 — the WS gateway's ownership check and
// scripts/realtime-demo.mjs both need user_id on every Order response now
// (see the field's own comment in orders.types.ts).
export const ORDER_RELATIONS = {
  items: { product: true },
  user: true,
} as const;

export function toApiOrder(entity: OrderEntity): Order {
  return {
    id: entity.id,
    status: entity.status,
    total_cents: Number(entity.amountCents),
    currency: entity.currency as Currency,
    items: (entity.items ?? []).map(item => ({
      productId: item.product.id,
      quantity: item.quantity,
    })),
    created_at: entity.createdAt.toISOString(),
    user_id: entity.user.id,
  };
}

// SSE wire format shared by both the buffered replay and the live stream
// below — id: is what makes EventSource's Last-Event-ID resume work.
export function writeSseEvent(res: Response, event: OrderStatusEvent): void {
  res.write(
    `id: ${event.id}\nevent: order.status\ndata: ${JSON.stringify({
      orderId: event.orderId,
      status: event.status,
      ts: event.ts,
    })}\n\n`,
  );
}

// The wire contract for order.placed (RabbitMQ, HW #19). Deliberately
// designed, not an ORM entity spread: consumers read exactly this shape, so
// it stays small and changes only through `type`.
export const orderPlacedSchema: z.ZodType<OrderPlacedEvent> = z.object({
  // Stable across redeliveries: the consumer's duplicate handle is order_id,
  // but eventId is what a future audit or outbox (HW #22) keys on.
  eventId: z.uuid(),
  type: z.literal('order.placed'),
  // When the business fact happened, not when it was published.
  occurredAt: z.iso.datetime(),
  data: z.object({
    orderId: z.number().int().positive(),
    userId: z.number().int().positive(),
    amountCents: z.number().int().nonnegative(),
    currency: z.string().min(1),
    items: z
      .array(
        z.object({
          productId: z.number().int().positive(),
          quantity: z.number().int().positive(),
        }),
      )
      .min(1),
  }),
});

export function toOrderPlacedEvent(
  source: OrderPlacedSource,
): OrderPlacedEvent {
  return {
    eventId: randomUUID(),
    type: 'order.placed',
    occurredAt: source.occurredAt.toISOString(),
    data: {
      orderId: source.orderId,
      userId: source.userId,
      amountCents: Number(source.amountCents),
      currency: source.currency,
      items: source.items,
    },
  };
}

// Only called from checkout's success path, so every event is a paid order.
export function buildOrderPlaced(order: Order): OrderPlacedEvent {
  return toOrderPlacedEvent({
    orderId: order.id,
    userId: order.user_id,
    amountCents: order.total_cents,
    currency: order.currency,
    occurredAt: new Date(order.created_at),
    items: order.items,
  });
}

// The wire contract for order.status_changed (BullMQ webhook, HW #23) —
// same discipline as orderPlacedSchema: the webhook consumer's defensive
// parse is typed against this, so the runtime check and the type cannot
// drift apart.
export const orderStatusChangedSchema: z.ZodType<OrderStatusChangedEvent> =
  z.object({
    eventId: z.uuid(),
    type: z.literal('order.status_changed'),
    occurredAt: z.iso.datetime(),
    data: z.object({
      orderId: z.number().int().positive(),
      status: z.enum(['unpaid', 'pending', 'paid', 'refunded']),
    }),
  });

export function toOrderStatusChangedEvent(
  source: OrderStatusChangedSource,
): OrderStatusChangedEvent {
  return {
    eventId: randomUUID(),
    type: 'order.status_changed',
    occurredAt: source.occurredAt.toISOString(),
    data: {
      orderId: source.orderId,
      status: source.status,
    },
  };
}
