import { UseGuards } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

import { OrderEventsService } from './order-events.service.ts';
import { OrderOwnershipGuard } from './order-ownership.guard.ts';

interface JoinPayload {
  orderId: number;
}

const roomFor = (orderId: number): string => `orders:${orderId}`;

// Attaches to the same HTTP server app.listen(PORT) already binds — no
// second port, no second process (unlike Lecture 18 step 8's standalone
// demo app). Room membership and the room-emit itself are the only things
// this class does; the event's ORIGIN is OrdersService.updateStatus(), and
// WHO gets in a room is OrderOwnershipGuard's job, not this one's.
@WebSocketGateway()
export class OrdersGateway implements OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly orderEvents: OrderEventsService) {}

  // Relays every published event to its own room. Emitting to a room with
  // nobody in it is a no-op, so one subscription for the gateway's whole
  // lifetime is enough — no per-join subscription bookkeeping needed.
  afterInit(): void {
    this.orderEvents.streamAll().subscribe(event => {
      this.server.to(roomFor(event.orderId)).emit('order.status', event);
    });
  }

  // By the time this runs, OrderOwnershipGuard has already verified
  // ownership (or thrown) — this handler is just "join the room, ack it".
  // Returning a plain value here is what NestJS forwards to the client's
  // ack callback (socket.emit('join', payload, ack => ...)) when one was
  // provided — no extra plumbing needed.
  @UseGuards(OrderOwnershipGuard)
  @SubscribeMessage('join')
  async join(
    @ConnectedSocket() client: Socket,
    @MessageBody() { orderId }: JoinPayload,
  ): Promise<{ ok: true; room: string }> {
    const room = roomFor(orderId);

    await client.join(room);

    return { ok: true, room };
  }
}
