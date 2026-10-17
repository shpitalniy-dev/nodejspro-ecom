import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

import type { PublishableEvent } from '../outbox/outbox.types.ts';

// Distinct token for the raw connection passed to `Queue`, separate from the
// `Queue` token itself — BullMQ's own backend treats a caller-supplied
// client on a non-blocking construct as "shared" and deliberately never
// closes it (see create-backend.js: "leaves caller-owned clients open"), so
// `queue.close()` alone is not enough; this class has to close the
// connection it was handed, the same way RedisConnectionService does for
// the cache/queue Redis connections elsewhere in this project.
export const QUEUE_REDIS_CONNECTION = Symbol('QUEUE_REDIS_CONNECTION');

// BullMQ mirror of RabbitMqPublisher — same reasoning: delivery mechanics
// (jobId, attempts, backoff, dedup-safe removeOnComplete) belong in a
// generic, reusable class, not inlined into whichever relay happens to be
// its first caller.
@Injectable()
export class BullMqPublisher implements OnModuleDestroy {
  constructor(
    private readonly queue: Queue,
    @Inject(QUEUE_REDIS_CONNECTION) private readonly connection: Redis,
  ) {}

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

  async onModuleDestroy(): Promise<void> {
    await this.queue.close().catch(() => undefined);
    await this.connection.quit().catch(() => undefined);
  }
}
