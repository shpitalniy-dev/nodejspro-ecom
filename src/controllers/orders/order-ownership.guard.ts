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
// message and the SSE `GET /orders/:orderId/events` request. NOT used by
// the plain `GET /orders/:orderId` read (HW#24 slice 3 moved that check
// into OrdersController itself — see getOne()'s own comment on why): a
// generic guard has no resource to compare against without a lookup of
// its own, and getOne() already runs the one query it needs regardless,
// so checking ownership there costs nothing extra. SSE and WS are
// different — neither loads a response body the way getOne() does, so
// there's no already-in-hand query to piggyback the owner's identity on;
// this guard's own lookup (getOwner()) is the cheapest it gets for them.
//
// The two transports verify identity very differently, and that's a
// deliberate, bounded gap, not an oversight: over HTTP, a preceding
// AuthGuard has already verified the caller's identity (a signed JWT) and
// set request.user, so this guard compares the order's real owner uuid
// against that verified claim. Over WS, no socket handshake auth exists
// yet — the client still just states its own userId in the 'join' body,
// unverified, exactly as before HW#24. Fixing that is a separate design
// decision (a handshake auth strategy), out of scope here. A rejection
// throws — a socket 'exception' event over WS, the matching 4xx problem
// response over HTTP (thrown before the SSE handler writes any header, so
// ProblemExceptionFilter still formats it).
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

    const owner = await this.ordersService.getOwner(orderId);

    if (owner === undefined) {
      this.reject(context, 'not_found', orderId);
    }

    const isOwner =
      context.getType() === 'http'
        ? owner.uuid === userId
        : owner.id === Number(userId);

    if (!isOwner) {
      this.reject(context, 'forbidden', orderId);
    }

    return true;
  }

  // HTTP: userId is the verified JWT subject (claims.sub, a uuid) set by
  // AuthGuard — never read from the request itself. WS: still the
  // client-stated, unverified integer id from the join body (see this
  // class's own comment on why that gap is deliberate for now).
  private readIdentity(context: ExecutionContext): Identity {
    if (context.getType() === 'http') {
      const req = context.switchToHttp().getRequest<Request>();

      return { orderId: req.params.orderId, userId: req.user?.sub };
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
