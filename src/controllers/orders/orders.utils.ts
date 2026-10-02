import type { Response } from 'express';

import { Order as OrderEntity } from '../../entities/order.entity.ts';
import type { Currency } from '../../types/index.ts';

import { OrderStatusEvent } from './order-events.service.ts';
import type { Order } from './orders.types.ts';

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
