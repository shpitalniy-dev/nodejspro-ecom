import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { InboxService } from '../../services/inbox.service.ts';

export type EffectOutcome = 'applied' | 'duplicate';

const CONSUMER = 'fulfillment';

@Injectable()
export class FulfillmentService {
  constructor(private readonly inbox: InboxService) {}

  async applyFulfillment(
    manager: EntityManager,
    orderId: number,
    messageId: string,
  ): Promise<EffectOutcome> {
    const claimed = await this.inbox.claim(manager, messageId, CONSUMER);

    if (!claimed) {
      return 'duplicate';
    }

    const inserted: Array<{ id: number }> = await manager.query(
      `INSERT INTO fulfillments (order_id) VALUES ($1)
       ON CONFLICT (order_id) DO NOTHING
       RETURNING id`,
      [orderId],
    );

    return inserted.length === 1 ? 'applied' : 'duplicate';
  }
}
