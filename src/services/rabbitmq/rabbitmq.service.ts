import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChannelModel } from 'amqplib';

import type { Env } from '../../config/env.schema.ts';

import { connectBroker } from './rabbitmq.connection.ts';

// Lazy, like DataSourceService: the app boots and `--wait` passes even when
// the broker is down. Only the first caller that needs a connection opens it.
@Injectable()
export class RabbitMqService implements OnModuleDestroy {
  private connection: Promise<ChannelModel> | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {}

  getConnection(): Promise<ChannelModel> {
    this.connection ??= connectBroker(
      this.config.get('BROKER_URL', { infer: true }),
    ).then(connection => {
      // amqplib never reconnects by itself: forget the dead connection so
      // the next caller opens a new one.
      connection.once('close', () => {
        this.connection = null;
      });

      return connection;
    });

    return this.connection.catch(error => {
      // Do not cache a failed attempt forever.
      this.connection = null;
      throw error;
    });
  }

  async onModuleDestroy(): Promise<void> {
    const connection = await this.connection?.catch(() => undefined);

    await connection?.close().catch(() => undefined);
  }
}
