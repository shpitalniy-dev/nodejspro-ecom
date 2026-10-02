import type { CanActivate, ExecutionContext } from '@nestjs/common';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import type { Request } from 'express';

import { OrdersService } from './orders.service.ts';

type Rejection = 'invalid_order' | 'anonymous' | 'not_found' | 'forbidden';

interface Identity {
  orderId: unknown;
  userId: unknown;
}

// Pure authorization boundary for both realtime transports: the WS 'join'
// message and the SSE `GET /orders/:orderId/events?userId=` request. No auth
// system exists yet (see orders.service.ts's own placeholder-customer note),
// so the client states its own userId, and this guard is what actually
// verifies it against the order's real owner in the DB before the handler
// ever runs. A rejection throws — a socket 'exception' event over WS, the
// matching 4xx problem response over HTTP (thrown before the SSE handler
// writes any header, so ProblemExceptionFilter still formats it). This is
// the first guard in the codebase; it's the natural slot real auth replaces
// later (HW#24), not a parallel mechanism sitting next to it.
@Injectable()
export class OrderOwnershipGuard implements CanActivate {
  constructor(private readonly ordersService: OrdersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { orderId: rawOrderId, userId } = this.readIdentity(context);
    // Guards run before pipes, so the HTTP path param is still a raw string.
    const orderId = Number(rawOrderId);

    if (!Number.isInteger(orderId) || orderId < 1) {
      this.reject(context, 'invalid_order', orderId);
    }

    if (userId == null || userId === '') {
      this.reject(context, 'anonymous', orderId);
    }

    const ownerId = await this.ordersService.getOwnerId(orderId);

    if (ownerId === undefined) {
      this.reject(context, 'not_found', orderId);
    }

    if (ownerId !== Number(userId)) {
      this.reject(context, 'forbidden', orderId);
    }

    return true;
  }

  private readIdentity(context: ExecutionContext): Identity {
    if (context.getType() === 'http') {
      const req = context.switchToHttp().getRequest<Request>();

      return { orderId: req.params.orderId, userId: req.query.userId };
    }

    const body = context
      .switchToWs()
      .getData<Partial<Record<keyof Identity, unknown>> | undefined>();

    return { orderId: body?.orderId, userId: body?.userId };
  }

  private reject(
    context: ExecutionContext,
    reason: Rejection,
    orderId: number,
  ): never {
    if (context.getType() !== 'http') {
      throw new WsException(reason);
    }

    switch (reason) {
      case 'invalid_order':
        throw new BadRequestException({
          title: 'Invalid order id',
          detail: 'orderId must be a positive integer.',
        });
      case 'anonymous':
        throw new UnauthorizedException({
          title: 'Anonymous request',
          detail: 'userId query parameter is required.',
        });
      case 'not_found':
        throw new NotFoundException({
          title: 'Order not found',
          detail: `Order "${orderId}" not found.`,
        });
      case 'forbidden':
        throw new ForbiddenException({
          title: 'Forbidden',
          detail: `Order "${orderId}" belongs to another user.`,
        });
    }
  }
}
