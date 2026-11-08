import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { Env } from './config/env.schema.ts';
import { ReadinessService } from './services/readiness.service.ts';
import { sleep } from './utils/sleep.ts';
import { AppModule } from './app.module.ts';
import { configureApp } from './configure-app.ts';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  app.enableShutdownHooks();

  configureApp(app);

  const config = app.get(ConfigService<Env, true>);
  const port = config.get('PORT', { infer: true });

  // HW #28 — not app config (see env.schema.ts), a deployment-lifecycle
  // knob: 0 everywhere except Stage 6's broken-profile demo, which raises
  // it so a rolling update actually has time to catch the app mid-startup.
  const warmupMs = Number(process.env.WARMUP_MS ?? 0);

  if (warmupMs > 0) {
    await sleep(warmupMs);
  }

  await app.listen(port);
  app.get(ReadinessService).markReady();
  console.log(`Listening on port ${port}`);
}

bootstrap();
