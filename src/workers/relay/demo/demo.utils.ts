import type { INestApplication } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DataSource } from 'typeorm';
import { IsNull } from 'typeorm';

import { validateWorker } from '../../../config/env.schema.ts';
import { OrderEventPublisher } from '../../../controllers/orders/orders.publisher.ts';
import { Outbox } from '../../../entities/outbox.entity.ts';
import { RabbitMqService } from '../../../services/rabbitmq/rabbitmq.service.ts';
import { RelayService } from '../relay.service.ts';

export async function countOutboxRows(
  dataSource: DataSource,
  orderId: number,
  { publishedOnly = false }: { publishedOnly?: boolean } = {},
): Promise<number> {
  const [{ n }] = await dataSource.query(
    `SELECT count(*)::int AS n FROM outbox
     WHERE aggregate_type = 'Order' AND aggregate_id = $1
       AND ($2 = false OR published_at IS NOT NULL)`,
    [String(orderId), publishedOnly],
  );

  return n;
}

export async function getOutboxEventId(
  dataSource: DataSource,
  orderId: number,
): Promise<string | undefined> {
  const rows: Array<{ event_id: string }> = await dataSource.query(
    `SELECT payload ->> 'eventId' AS event_id FROM outbox
     WHERE aggregate_type = 'Order' AND aggregate_id = $1
     LIMIT 1`,
    [String(orderId)],
  );

  return rows[0]?.event_id;
}

export async function countProcessedMessages(
  dataSource: DataSource,
  messageId: string,
): Promise<number> {
  const [{ n }] = await dataSource.query(
    `SELECT count(*)::int AS n FROM processed_messages
     WHERE message_id = $1 AND consumer = 'fulfillment'`,
    [messageId],
  );

  return n;
}

export async function resetStaleOutboxRows(
  dataSource: DataSource,
): Promise<void> {
  await dataSource.getRepository(Outbox).delete({ publishedAt: IsNull() });
}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateWorker })],
  providers: [RabbitMqService, OrderEventPublisher, RelayService],
})
export class DemoRelayModule {}

export interface DemoApiApp {
  app: INestApplication;
  close(): Promise<void>;
}

export async function startDemoApiApp(dbUrl: URL): Promise<DemoApiApp> {
  const passwordDir = await mkdtemp(path.join(os.tmpdir(), 'demo-api-'));
  const passwordFile = path.join(passwordDir, 'db-password');

  await writeFile(passwordFile, decodeURIComponent(dbUrl.password), {
    mode: 0o600,
  });

  process.env.PORT = '3100'; // never bound — app.init() is called below, not app.listen()
  process.env.DB_HOST = dbUrl.hostname;
  process.env.DB_PORT = dbUrl.port;
  process.env.DB_NAME = dbUrl.pathname.slice(1);
  process.env.DB_USER = decodeURIComponent(dbUrl.username);
  process.env.DB_PASSWORD_FILE = passwordFile;

  const { AppModule } = await import('../../../app.module.ts');
  const { configureApp } = await import('../../../configure-app.ts');

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
  });

  configureApp(app);
  await app.init();

  return {
    app,
    async close() {
      await app.close();
      await rm(passwordDir, { recursive: true, force: true });
    },
  };
}
