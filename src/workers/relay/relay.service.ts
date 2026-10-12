import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { OrderEventPublisher } from '../../controllers/orders/orders.publisher.ts';
import type { OrderPlacedEvent } from '../../controllers/orders/orders.types.ts';

export const DEFAULT_BATCH_SIZE = 20;

interface ClaimedRow {
  id: string;
  payload: OrderPlacedEvent;
}

export class DemoRelayCrashError extends Error {
  constructor() {
    super('demo:crash-relay forced interruption between publish and UPDATE');
    this.name = 'DemoRelayCrashError';
  }
}

@Injectable()
export class RelayService {
  constructor(private readonly publisher: OrderEventPublisher) {}

  async relayBatch(
    manager: EntityManager,
    batchSize: number = DEFAULT_BATCH_SIZE,
  ): Promise<number> {
    return manager.transaction(async tx => {
      const rows: ClaimedRow[] = await tx.query(
        `SELECT id, payload FROM outbox
         WHERE published_at IS NULL
         ORDER BY created_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT $1`,
        [batchSize],
      );

      for (const row of rows) {
        await this.publisher.publish(row.payload);

        if (process.env.DEMO_CRASH_AFTER_PUBLISH === '1') {
          throw new DemoRelayCrashError();
        }

        await tx.query(
          `UPDATE outbox SET published_at = now(), attempts = attempts + 1
           WHERE id = $1`,
          [row.id],
        );
      }

      return rows.length;
    });
  }
}
