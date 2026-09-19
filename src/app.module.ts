import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validate } from './config/env.schema.ts';
import { HealthController } from './controllers/health/health.controller.ts';
import { OrdersController } from './controllers/orders/orders.controller.ts';
import { OrdersService } from './controllers/orders/orders.service.ts';
import { ProductsController } from './controllers/products/products.controller.ts';
import { ProductsService } from './controllers/products/products.service.ts';
import { IdempotencyKeyInterceptor } from './interceptors/idempotency-key.interceptor.ts';
import { LocationHeaderInterceptor } from './interceptors/location-header.interceptor.ts';
import { DataSourceService } from './services/data-source.service.ts';
import { DatabaseService } from './services/database.service.ts';
import { IdempotencyStore } from './services/idempotency-store.service.ts';

@Module({
  controllers: [HealthController, ProductsController, OrdersController],
  providers: [
    ProductsService,
    OrdersService,
    IdempotencyStore,
    IdempotencyKeyInterceptor,
    LocationHeaderInterceptor,
    DatabaseService,
    DataSourceService,
  ],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
  ],
})
export class AppModule {}
