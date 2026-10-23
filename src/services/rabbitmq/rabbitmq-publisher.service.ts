import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { ConfirmChannel } from 'amqplib';

import type { PublishableEvent } from '../outbox/outbox.types.ts';

import { RabbitMqService } from './rabbitmq.service.ts';
import { EXCHANGE } from './rabbitmq.topology.ts';

@Injectable()
export class RabbitMqPublisher implements OnModuleDestroy {
  private channel: Promise<ConfirmChannel> | null = null;

  constructor(private readonly broker: RabbitMqService) {}

  async publish(event: PublishableEvent): Promise<void> {
    const channel = await this.getChannel();

    channel.publish(EXCHANGE, event.type, Buffer.from(JSON.stringify(event)), {
      persistent: true,
      contentType: 'application/json',
      messageId: event.eventId,
      type: event.type,
      timestamp: Date.parse(event.occurredAt),
    });

    await channel.waitForConfirms();
  }

  private getChannel(): Promise<ConfirmChannel> {
    this.channel ??= this.broker
      .getConnection()
      .then(connection => connection.createConfirmChannel())
      .then(channel => {
        // A channel closed by the broker (e.g. 404 on a missing exchange)
        // must be replaced, or every later publish fails on a dead channel.
        // A broker-side channel error (e.g. 404 on a missing exchange) arrives
        // as an 'error' event on the channel, not the connection, so log it
        // here with its real cause.
        channel.on('error', error => {
          console.error('[rabbitmq] publish channel error', error);
        });

        channel.once('close', () => {
          this.channel = null;
        });

        return channel;
      });

    return this.channel.catch(error => {
      this.channel = null;
      throw error;
    });
  }

  async onModuleDestroy(): Promise<void> {
    const channel = await this.channel?.catch(() => undefined);

    await channel?.close().catch(() => undefined);
  }
}
