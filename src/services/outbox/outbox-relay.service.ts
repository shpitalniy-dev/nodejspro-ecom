import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

export const DEFAULT_BATCH_SIZE = 20;

interface ClaimedRow {
  id: string;
  payload: Record<string, unknown>;
}

export class DemoRelayCrashError extends Error {
  constructor() {
    super('demo:crash-relay forced interruption between publish and UPDATE');
    this.name = 'DemoRelayCrashError';
  }
}

// Generic claim/deliver/mark loop for the transactional outbox pattern
// (HW #22), shared by every sink this app delivers outbox events to.
// Parameterized by which event `type`s to claim — an array, not a single
// string: the common outbox-relay pattern (this is how Debezium's own
// Outbox Event Router works) is one relay per *destination*, claiming
// every row bound for it and using `type` as routing info. A single
// string would force a whole new relay class just to add a second event
// type to the *same* sink later; an array means a relay can grow its own
// coverage with a one-line change, no new class.
@Injectable()
export abstract class OutboxRelayService {
  constructor(private readonly eventTypes: string[]) {}

  async relayBatch(
    manager: EntityManager,
    batchSize: number = DEFAULT_BATCH_SIZE,
  ): Promise<number> {
    return manager.transaction(async tx => {
      const rows: ClaimedRow[] = await tx.query(
        `SELECT id, payload FROM outbox
         WHERE published_at IS NULL AND type = ANY($1)
         ORDER BY created_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT $2`,
        [this.eventTypes, batchSize],
      );

      for (const row of rows) {
        await this.deliver(row.payload);

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

  protected abstract deliver(payload: Record<string, unknown>): Promise<void>;
}
