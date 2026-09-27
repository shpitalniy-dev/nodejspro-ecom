import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';

import { OrdersService } from './orders.service.ts';

interface JoinPayload {
  orderId?: number;
  userId?: number;
}

// Pure authorization boundary for the WS 'join' handler. No auth system
// exists yet (see orders.service.ts's own placeholder-customer note), so
// the client states its own userId, and this guard is what actually
// verifies it against the order's real owner in the DB before the handler
// ever runs. A rejection throws — the client sees a socket 'exception'
// event, the same shape an HTTP guard's 403 would take. This is the first
// guard in the codebase; it's the natural slot real auth replaces later
// (HW#24), not a parallel mechanism sitting next to it.
@Injectable()
export class OrderOwnershipGuard implements CanActivate {
  constructor(private readonly ordersService: OrdersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const body = context.switchToWs().getData<JoinPayload>();
    const orderId = Number(body?.orderId);

    if (!Number.isInteger(orderId) || orderId < 1) {
      throw new WsException('invalid_order');
    }

    if (body?.userId == null) {
      throw new WsException('anonymous');
    }

    const ownerId = await this.ordersService.getOwnerId(orderId);

    if (ownerId === undefined) {
      throw new WsException('not_found');
    }

    if (ownerId !== Number(body.userId)) {
      throw new WsException('forbidden');
    }

    return true;
  }
}
