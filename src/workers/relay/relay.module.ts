import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import type { WebhookWorkerEnv } from '../../config/env.schema.ts';
import { validateWorker } from '../../config/env.schema.ts';
import {
  BullMqPublisher,
  QUEUE_REDIS_CONNECTION,
} from '../../services/bullmq/bullmq-publisher.service.ts';
import { DataSourceService } from '../../services/data-source.service.ts';
import { RabbitMqService } from '../../services/rabbitmq/rabbitmq.service.ts';
import { RabbitMqPublisher } from '../../services/rabbitmq/rabbitmq-publisher.service.ts';
import { createRedisClient } from '../../services/redis/redis.factory.ts';
import { QUEUE_NAME } from '../webhook/webhook-consumer.worker.ts';

import { RelayService } from './relay.service.ts';
import { RelayWorker } from './relay.worker.ts';

// Same shape as FulfillmentModule — its own process, its own DataSource
// connection, no HTTP. Hosts the outbox relay for BOTH sinks it claims:
// order.placed -> RabbitMQ (RabbitMqPublisher) and order.status_changed ->
// BullMQ (BullMqPublisher, which enqueues for WebhookConsumerModule's own
// separate process to actually deliver). validateWorker already covers
// REDIS_QUEUE_URL (added in HW #23 slices 2-3), so no new env schema is
// needed here.
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateWorker,
    }),
  ],
  providers: [
    DataSourceService,
    RabbitMqService,
    RabbitMqPublisher,
    {
      // The PRODUCER connection — never shared with WebhookConsumerWorker's
      // own connection, per BullMQ's own requirement (see redis.factory.ts).
      // Provided under its own token (not just handed to Queue inline) so
      // BullMqPublisher can close it itself on shutdown — BullMQ's own
      // backend treats a caller-supplied client on a non-blocking construct
      // like Queue as "shared" and never closes it on queue.close().
      provide: QUEUE_REDIS_CONNECTION,
      useFactory: (config: ConfigService<WebhookWorkerEnv, true>) =>
        createRedisClient(config.get('REDIS_QUEUE_URL', { infer: true }), {
          maxRetriesPerRequest: null,
        }),
      inject: [ConfigService],
    },
    {
      provide: Queue,
      useFactory: (connection: ReturnType<typeof createRedisClient>) =>
        new Queue(QUEUE_NAME, { connection }),
      inject: [QUEUE_REDIS_CONNECTION],
    },
    BullMqPublisher,
    RelayService,
    RelayWorker,
  ],
})
export class RelayModule {}
