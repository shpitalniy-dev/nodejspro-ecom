import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validate } from './config/env.schema.ts';
import { HealthController } from './controllers/health/health.controller.ts';
import { OrderEventsService } from './controllers/orders/order-events.service.ts';
import { OrderOwnershipGuard } from './controllers/orders/order-ownership.guard.ts';
import { OrdersController } from './controllers/orders/orders.controller.ts';
import { OrdersGateway } from './controllers/orders/orders.gateway.ts';
import { OrderEventPublisher } from './controllers/orders/orders.publisher.ts';
import { OrdersService } from './controllers/orders/orders.service.ts';
import { ProductsController } from './controllers/products/products.controller.ts';
import { ProductsService } from './controllers/products/products.service.ts';
import { IdempotencyKeyInterceptor } from './interceptors/idempotency-key.interceptor.ts';
import { LocationHeaderInterceptor } from './interceptors/location-header.interceptor.ts';
import { DataSourceService } from './services/data-source.service.ts';
import { DatabaseService } from './services/database.service.ts';
import { IdempotencyStore } from './services/idempotency-store.service.ts';
import { RabbitMqService } from './services/rabbitmq/rabbitmq.service.ts';

@Module({
  controllers: [HealthController, ProductsController, OrdersController],
  providers: [
    ProductsService,
    OrdersService,
    OrderEventsService,
    OrdersGateway,
    OrderOwnershipGuard,
    IdempotencyStore,
    IdempotencyKeyInterceptor,
    LocationHeaderInterceptor,
    DatabaseService,
    DataSourceService,
    RabbitMqService,
    OrderEventPublisher,
  ],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
  ],
})
export class AppModule {}
