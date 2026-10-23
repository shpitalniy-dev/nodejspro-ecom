import { Injectable } from '@nestjs/common';

import { BullMqPublisher } from '../../services/bullmq/bullmq-publisher.service.ts';
import type { PublishableEvent } from '../../services/outbox/outbox.types.ts';
import { OutboxRelayService } from '../../services/outbox/outbox-relay.service.ts';
import { RabbitMqPublisher } from '../../services/rabbitmq/rabbitmq-publisher.service.ts';

export {
  DEFAULT_BATCH_SIZE,
  DemoRelayCrashError,
} from '../../services/outbox/outbox-relay.service.ts';

@Injectable()
export class RelayService extends OutboxRelayService {
  constructor(
    private readonly rabbitMqPublisher: RabbitMqPublisher,
    private readonly bullMqPublisher: BullMqPublisher,
  ) {
    super(['order.placed', 'order.status_changed']);
  }

  protected async deliver(payload: Record<string, unknown>): Promise<void> {
    const event = payload as PublishableEvent;

    switch (event.type) {
      case 'order.placed':
        await this.rabbitMqPublisher.publish(event);
        break;
      case 'order.status_changed':
        await this.bullMqPublisher.publish(event);
        break;
      default:
        throw new Error(`RelayService: unhandled event type "${event.type}"`);
    }
  }
}
