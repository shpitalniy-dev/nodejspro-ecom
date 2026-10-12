import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { RelayModule } from './relay.module.ts';

// Standalone application context: DI and lifecycle hooks, no HTTP listener.
// enableShutdownHooks() turns SIGTERM/SIGINT into a clean close, which runs
// RelayWorker's onModuleDestroy.
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(RelayModule);

  app.enableShutdownHooks();
}

bootstrap();
