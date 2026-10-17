import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

@Injectable()
export class InboxService {
  async claim(
    manager: EntityManager,
    messageId: string,
    consumer: string,
  ): Promise<boolean> {
    const claimed: Array<{ message_id: string }> = await manager.query(
      `INSERT INTO processed_messages (message_id, consumer) VALUES ($1, $2)
       ON CONFLICT (message_id, consumer) DO NOTHING
       RETURNING message_id`,
      [messageId, consumer],
    );

    return claimed.length === 1;
  }

  // Unlike claim(), this isn't an atomic gate-before-effect — it's a plain
  // check, meant to run BEFORE a non-transactional effect (an HTTP call)
  // that can't share a transaction with the record of having done it.
  async wasProcessed(
    manager: EntityManager,
    messageId: string,
    consumer: string,
  ): Promise<boolean> {
    const rows: unknown[] = await manager.query(
      `SELECT 1 FROM processed_messages WHERE message_id = $1 AND consumer = $2`,
      [messageId, consumer],
    );

    return rows.length > 0;
  }

  // Pairs with wasProcessed() — call this AFTER a non-transactional effect
  // succeeds, so the record survives even if something later in the
  // caller's own transaction rolls back.
  async recordProcessed(
    manager: EntityManager,
    messageId: string,
    consumer: string,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO processed_messages (message_id, consumer) VALUES ($1, $2)
       ON CONFLICT (message_id, consumer) DO NOTHING`,
      [messageId, consumer],
    );
  }
}
