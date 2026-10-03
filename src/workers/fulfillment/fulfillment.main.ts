import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { FulfillmentModule } from './fulfillment.module.ts';

// Standalone application context: DI and lifecycle hooks, no HTTP listener.
// enableShutdownHooks() turns SIGTERM/SIGINT into a clean close, which runs
// the worker's onModuleDestroy.
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(FulfillmentModule);

  app.enableShutdownHooks();
}

bootstrap();
