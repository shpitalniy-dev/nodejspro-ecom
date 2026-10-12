import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateWorker } from '../../config/env.schema.ts';
import { OrderEventPublisher } from '../../controllers/orders/orders.publisher.ts';
import { DataSourceService } from '../../services/data-source.service.ts';
import { RabbitMqService } from '../../services/rabbitmq/rabbitmq.service.ts';

import { RelayService } from './relay.service.ts';
import { RelayWorker } from './relay.worker.ts';

// Same shape as FulfillmentModule — its own process, its own DataSource
// connection, no HTTP.
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
    OrderEventPublisher,
    RelayService,
    RelayWorker,
  ],
})
export class RelayModule {}
