import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { WebhookConsumerModule } from './webhook-consumer.module.ts';

// Standalone application context: DI and lifecycle hooks, no HTTP listener.
// Same shape as relay.main.ts/fulfillment.main.ts — no compose service, no
// npm script, matching that exact precedent; only ever exercised
// in-process or via a demo-spawned child process.
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WebhookConsumerModule);

  app.enableShutdownHooks();
}

bootstrap();
