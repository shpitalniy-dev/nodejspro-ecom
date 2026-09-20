import { Order as OrderEntity } from '../../entities/order.entity.ts';
import type { Currency } from '../../types/index.ts';

import type { Order } from './orders.types.ts';

export const ORDER_RELATIONS = { items: { product: true } } as const;

export function toApiOrder(entity: OrderEntity): Order {
  return {
    id: entity.id,
    // checkout() is the only writer behind this endpoint and always sets
    // 'paid' — narrower than the entity's full OrderStatus, but that's all
    // this endpoint ever produces.
    status: entity.status as 'unpaid' | 'paid',
    total_cents: Number(entity.amountCents),
    currency: entity.currency as Currency,
    items: (entity.items ?? []).map(item => ({
      productId: item.product.id,
      quantity: item.quantity,
    })),
    created_at: entity.createdAt.toISOString(),
  };
}
