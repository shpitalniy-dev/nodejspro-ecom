import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateWebhookWorker } from '../../config/env.schema.ts';
import { DataSourceService } from '../../services/data-source.service.ts';
import { InboxService } from '../../services/inbox.service.ts';

import { WebhookConsumerWorker } from './webhook-consumer.worker.ts';

// Same shape as RelayModule/FulfillmentModule — its own process, its own
// DataSource connection, no HTTP. Only the BullMQ consumer lives here; the
// outbox-polling producer side is RelayModule's job now (it enqueues via
// BullMqPublisher), kept separate so a stuck/crashing webhook delivery
// can't take the outbox relay down with it.
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateWebhookWorker,
    }),
  ],
  providers: [DataSourceService, InboxService, WebhookConsumerWorker],
})
export class WebhookConsumerModule {}
