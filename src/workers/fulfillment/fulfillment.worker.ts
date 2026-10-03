import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Channel, ConsumeMessage } from 'amqplib';

import { FulfillmentService } from '../../controllers/fulfillment/fulfillment.service.ts';
import { orderPlacedSchema } from '../../controllers/orders/orders.utils.ts';
import { DataSourceService } from '../../services/data-source.service.ts';
import { RabbitMqService } from '../../services/rabbitmq/rabbitmq.service.ts';
import {
  declareTopology,
  QUEUE,
} from '../../services/rabbitmq/rabbitmq.topology.ts';
import { parseJson } from '../../utils/parse-json.ts';
import { isForeignKeyViolation } from '../../utils/pg-error.ts';

// prefetch = max unacknowledged messages per consumer. Default 0 means
// unlimited: the first consumer would take the whole queue.
// Budget: prefetch × processing time < consumer_timeout (30 min by default).
// One fulfilment is one indexed INSERT, a few ms, so 20 × ~5 ms ≈ 100 ms.
// 20 keeps the pipe full (prefetch 1 would wait for every ack round-trip),
// and it stays far below the 2000 quorum-queue ceiling.
const PREFETCH = 20;

// The fulfilment worker: consumes order.placed for the lifetime of the
// process. It declares the topology (the consumer owns it, the producer never
// does), then acknowledges each message only after its effect has committed.
// Nothing here knows about HTTP.
@Injectable()
export class FulfillmentWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private channel: Channel | null = null;
  private consumerTag: string | null = null;

  constructor(
    private readonly broker: RabbitMqService,
    private readonly dataSourceService: DataSourceService,
    private readonly fulfillment: FulfillmentService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const connection = await this.broker.getConnection();
    const channel = await connection.createChannel();

    await declareTopology(channel);
    await channel.prefetch(PREFETCH);

    const { consumerTag } = await channel.consume(
      QUEUE,
      msg => {
        // A null message means the broker cancelled this consumer (queue
        // deleted, consumer timeout). Ignoring it would leave a process that
        // stays alive and never receives anything. Exit so the supervisor
        // restarts it.
        if (msg === null) {
          console.error('[fulfillment-worker] cancelled by broker, exiting');
          process.exit(1);
        }

        void this.handle(channel, msg);
      },
      { noAck: false }, // manual ack: acknowledge only after the effect
    );

    this.channel = channel;
    this.consumerTag = consumerTag;

    console.log('[fulfillment-worker] consuming order.placed');
  }

  private async handle(channel: Channel, msg: ConsumeMessage): Promise<void> {
    const parsed = orderPlacedSchema.safeParse(parseJson(msg.content));

    if (!parsed.success) {
      // A malformed payload can never succeed. requeue=false sends it to
      // the DLQ with reason `rejected`.
      channel.reject(msg, false);

      return;
    }

    try {
      const manager = await this.dataSourceService.getManager();

      await manager.transaction(tx =>
        this.fulfillment.applyFulfillment(tx, parsed.data.data.orderId),
      );

      // ack means "I no longer need a redelivery". Send it only after the
      // effect has committed.
      channel.ack(msg);
    } catch (error) {
      // reject, not nack: only reject counts toward x-delivery-limit.
      // Permanent failures go to the DLQ now; transient ones are retried
      // until the limit is reached.
      // A missing order cannot appear by retrying, so that goes to the DLQ.
      // Anything else (connection lost, timeout) is transient.
      channel.reject(msg, !isForeignKeyViolation(error));
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Stop taking new messages first; in-flight ones finish and are acked or
    // rejected before the channel closes. Errors are ignored: the connection
    // may already be closing, and shutdown must not fail on that.
    if (this.channel && this.consumerTag) {
      await this.channel
        .cancel(this.consumerTag)
        .then(() => this.channel?.close())
        .catch(() => undefined);
    }
  }
}
