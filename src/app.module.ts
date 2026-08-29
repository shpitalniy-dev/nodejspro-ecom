import { Module } from '@nestjs/common';

import { HealthController } from './controllers/health/health.controller.ts';
import { OrdersController } from './controllers/orders/orders.controller.ts';
import { ProductsController } from './controllers/products/products.controller.ts';
import { IdempotencyKeyInterceptor } from './interceptors/idempotency-key.interceptor.ts';
import { LocationHeaderInterceptor } from './interceptors/location-header.interceptor.ts';
import { IdempotencyStore } from './services/idempotency-store.service.ts';
import { OrderService } from './services/order.service.ts';
import { ProductService } from './services/product.service.ts';

@Module({
  controllers: [HealthController, ProductsController, OrdersController],
  providers: [
    ProductService,
    OrderService,
    IdempotencyStore,
    IdempotencyKeyInterceptor,
    LocationHeaderInterceptor,
  ],
})
export class AppModule {}
