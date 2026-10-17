import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';

import type { PublishableEvent } from '../outbox/outbox.types.ts';

// BullMQ mirror of RabbitMqPublisher — same reasoning: delivery mechanics
// (jobId, attempts, backoff, dedup-safe removeOnComplete) belong in a
// generic, reusable class, not inlined into whichever relay happens to be
// its first caller.
@Injectable()
export class BullMqPublisher {
  constructor(private readonly queue: Queue) {}

  async publish(event: PublishableEvent): Promise<void> {
    await this.queue.add(event.type, event, {
      jobId: event.eventId,
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000, jitter: 0.5 },
      // NOT `removeOnComplete: true` — that deletes the job record on
      // completion, which silently disables jobId dedup for any later
      // add() reusing the same id.
      removeOnComplete: { age: 3600 },
    });
  }
}
