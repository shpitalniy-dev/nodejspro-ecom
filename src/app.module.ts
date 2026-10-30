import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import type { Env } from './config/env.schema.ts';
import { validate } from './config/env.schema.ts';
import { JwtKeysService } from './config/jwt-keys.ts';
import { AccessDenylistService } from './controllers/auth/access-denylist.service.ts';
import { AccessTokenService } from './controllers/auth/access-token.service.ts';
import { AuthController } from './controllers/auth/auth.controller.ts';
import {
  AuthGuard,
  LoginRateLimitGuard,
  RolesGuard,
} from './controllers/auth/auth.guards.ts';
import { AuthService } from './controllers/auth/auth.service.ts';
import { PasswordService } from './controllers/auth/password.service.ts';
import { RefreshGraceCacheService } from './controllers/auth/refresh-grace-cache.service.ts';
import { RefreshTokenService } from './controllers/auth/refresh-token.service.ts';
import { HealthController } from './controllers/health/health.controller.ts';
import { OrderEventsService } from './controllers/orders/order-events.service.ts';
import { OrderOwnershipGuard } from './controllers/orders/order-ownership.guard.ts';
import { OrdersController } from './controllers/orders/orders.controller.ts';
import { OrdersGateway } from './controllers/orders/orders.gateway.ts';
import { OrdersService } from './controllers/orders/orders.service.ts';
import { ProductsController } from './controllers/products/products.controller.ts';
import { ProductsListRateLimitGuard } from './controllers/products/products.guards.ts';
import { ProductsService } from './controllers/products/products.service.ts';
import { IdempotencyKeyInterceptor } from './interceptors/idempotency-key.interceptor.ts';
import { LocationHeaderInterceptor } from './interceptors/location-header.interceptor.ts';
import { CacheAsideService } from './services/cache/cache-aside.service.ts';
import { ConcurrencyLimiter } from './services/concurrency-limiter.ts';
import { DataSourceService } from './services/data-source.service.ts';
import { DatabaseService } from './services/database.service.ts';
import { IdempotencyStore } from './services/idempotency-store.service.ts';
import { LoggerService } from './services/logger.service.ts';
import { RabbitMqService } from './services/rabbitmq/rabbitmq.service.ts';
import { TokenBucketService } from './services/rate-limit/token-bucket.service.ts';
import { CacheRedisConnection } from './services/redis/cache-redis-connection.service.ts';
import { QueueRedisConnection } from './services/redis/queue-redis-connection.service.ts';

@Module({
  controllers: [
    HealthController,
    ProductsController,
    OrdersController,
    AuthController,
  ],
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
    LoggerService,
    CacheRedisConnection,
    QueueRedisConnection,
    ProductsListRateLimitGuard,
    JwtKeysService,
    ConcurrencyLimiter,
    PasswordService,
    AccessTokenService,
    RefreshTokenService,
    AuthService,
    AuthGuard,
    LoginRateLimitGuard,
    RolesGuard,
    {
      provide: CacheAsideService,
      useFactory: async (conn: CacheRedisConnection, logger: LoggerService) =>
        new CacheAsideService(await conn.getClient(), logger),
      inject: [CacheRedisConnection, LoggerService],
    },
    {
      provide: TokenBucketService,
      useFactory: async (conn: QueueRedisConnection) =>
        new TokenBucketService(await conn.getClient()),
      inject: [QueueRedisConnection],
    },
    {
      provide: AccessDenylistService,
      useFactory: async (conn: QueueRedisConnection) =>
        new AccessDenylistService(await conn.getClient()),
      inject: [QueueRedisConnection],
    },
    {
      provide: RefreshGraceCacheService,
      useFactory: async (
        conn: QueueRedisConnection,
        config: ConfigService<Env, true>,
      ) => new RefreshGraceCacheService(await conn.getClient(), config),
      inject: [QueueRedisConnection, ConfigService],
    },
  ],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
  ],
})
export class AppModule {}
