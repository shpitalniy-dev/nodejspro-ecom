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
}
