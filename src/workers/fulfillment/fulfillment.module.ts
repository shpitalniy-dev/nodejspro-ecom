import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateWorker } from '../../config/env.schema.ts';
import { FulfillmentService } from '../../controllers/fulfillment/fulfillment.service.ts';
import { DataSourceService } from '../../services/data-source.service.ts';
import { RabbitMqService } from '../../services/rabbitmq/rabbitmq.service.ts';

import { FulfillmentWorker } from './fulfillment.worker.ts';

// Same DataSourceService as the API: app_user, the rotating password file,
// and the same pool. The worker runs as its own compose service next to api,
// mounting the same secrets volume, so it reads the same password path.
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
    FulfillmentService,
    FulfillmentWorker,
  ],
})
export class FulfillmentModule {}
