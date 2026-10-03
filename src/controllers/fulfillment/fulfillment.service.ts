import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

export type EffectOutcome = 'applied' | 'duplicate';

@Injectable()
export class FulfillmentService {
  // The business key (order_id, UNIQUE in the fulfillments table) is the
  // idempotency key. The same event delivered N times leaves one row.
  async applyFulfillment(
    manager: EntityManager,
    orderId: number,
  ): Promise<EffectOutcome> {
    const inserted: Array<{ id: number }> = await manager.query(
      `INSERT INTO fulfillments (order_id) VALUES ($1)
       ON CONFLICT (order_id) DO NOTHING
       RETURNING id`,
      [orderId],
    );

    return inserted.length === 1 ? 'applied' : 'duplicate';
  }
}
