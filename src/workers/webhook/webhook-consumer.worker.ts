import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { Worker } from 'bullmq';

import type { WebhookWorkerEnv } from '../../config/env.schema.ts';
import { orderStatusChangedSchema } from '../../controllers/orders/orders.utils.ts';
import { DataSourceService } from '../../services/data-source.service.ts';
import { InboxService } from '../../services/inbox.service.ts';
import { createRedisClient } from '../../services/redis/redis.factory.ts';

export const QUEUE_NAME = 'order.status_changed';
const CONSUMER = 'webhook';

// Owns the BullMQ Worker instance and the actual webhook delivery. Its own
// Redis connection — never shared with RelayModule's Queue (producer) side,
// since a Worker's blocking commands would stall Queue.add() calls queued
// behind it on the same socket.
@Injectable()
export class WebhookConsumerWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private worker: Worker | null = null;

  constructor(
    private readonly config: ConfigService<WebhookWorkerEnv, true>,
    private readonly dataSourceService: DataSourceService,
    private readonly inbox: InboxService,
  ) {}

  onApplicationBootstrap(): void {
    const consumerConnection = createRedisClient(
      this.config.get('REDIS_QUEUE_URL', { infer: true }),
      { maxRetriesPerRequest: null },
    );

    this.worker = new Worker(
      QUEUE_NAME,
      async (job: Job) => {
        const parsed = orderStatusChangedSchema.safeParse(job.data);

        if (!parsed.success) {
          throw new Error('invalid webhook job payload');
        }

        const manager = await this.dataSourceService.getManager();

        // BullMQ's at-least-once processing can redeliver the same job to
        // a handler (e.g. a stalled lock after a crash mid-handler), which
        // jobId-based dedup on add() doesn't protect against — only this
        // check-then-record around the actual delivery does.
        if (
          await this.inbox.wasProcessed(manager, parsed.data.eventId, CONSUMER)
        ) {
          return;
        }

        const webhookUrl = this.config.get('ORDER_STATUS_WEBHOOK_URL', {
          infer: true,
        });

        console.log(
          `[webhook] order ${parsed.data.data.orderId} -> ${parsed.data.data.status}`,
        );

        // A real HTTP call is attempted only if a URL is configured —
        // consistent with how every other external boundary in this
        // project stays reproducible offline by default. A failure is
        // left to throw, not swallowed: BullMQ's own attempts/backoff
        // (configured on the job by BullMqPublisher) is what's supposed
        // to retry this.
        if (webhookUrl) {
          const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(parsed.data),
          });

          if (!response.ok) {
            throw new Error(
              `webhook POST to ${webhookUrl} failed with status ${response.status}`,
            );
          }
        }

        await this.inbox.recordProcessed(
          manager,
          parsed.data.eventId,
          CONSUMER,
        );
      },
      { connection: consumerConnection },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
  }
}
