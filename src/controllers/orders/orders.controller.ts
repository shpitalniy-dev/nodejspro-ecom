import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { IdempotencyKeyInterceptor } from '../../interceptors/idempotency-key.interceptor.ts';
import { LocationHeaderInterceptor } from '../../interceptors/location-header.interceptor.ts';

import { OrderEventsService } from './order-events.service.ts';
import { OrderOwnershipGuard } from './order-ownership.guard.ts';
import { CreateOrderDto, UpdateOrderStatusDto } from './orders.dto.ts';
import { OrdersService } from './orders.service.ts';
import { writeSseEvent } from './orders.utils.ts';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderEvents: OrderEventsService,
  ) {}

  @Get()
  async list(
    @Query('limit', ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.ordersService.list(limit, cursor);
  }

  @Post()
  @HttpCode(201)
  @UseInterceptors(LocationHeaderInterceptor, IdempotencyKeyInterceptor)
  async create(@Body() body: CreateOrderDto) {
    return this.ordersService.create(body.items);
  }

  @Get(':orderId')
  async getOne(@Param('orderId', ParseIntPipe) orderId: number) {
    const order = await this.ordersService.findById(orderId);

    if (!order) {
      throw new NotFoundException({
        title: 'Order not found',
        detail: `Order "${orderId}" not found.`,
      });
    }

    return order;
  }

  @Patch(':orderId/status')
  async updateStatus(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() body: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(orderId, body.status);
  }

  // Not @Sse() — Nest's built-in decorator formats a fixed MessageEvent
  // shape and doesn't give access to the incoming Last-Event-ID header
  // alongside a hand-controlled first write (the retry: preamble). @Res()
  // trades Nest's automatic response handling for that control; throwing
  // before res.writeHead() still reaches ProblemExceptionFilter normally
  // (filters read the response off ArgumentsHost, independent of @Res()).
  //
  // This path is excluded from OpenAPI response validation (configure-app.ts
  // ignorePaths) — validateResponses:true would have to buffer the whole
  // response to check it, which is incompatible with a stream designed to
  // never end.
  @Get(':orderId/events')
  @UseGuards(OrderOwnershipGuard)
  streamEvents(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Req() req: Request,
    @Res() res: Response,
  ): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    // No compression middleware sits in front of this route, so res.write()
    // already reaches the socket uncached — flushHeaders()/setNoDelay() are
    // about a lower layer than that: without them, Node can hold the
    // connection's very first bytes (headers, or a short write like an SSE
    // frame) waiting to coalesce with more data (TCP's Nagle's algorithm),
    // which is exactly the kind of invisible latency a "push this now"
    // transport shouldn't have.
    res.flushHeaders();
    res.socket?.setNoDelay(true);
    // Sets the client's reconnect pace (Lecture 18, step 3) — without this,
    // EventSource's default reconnect delay is several seconds, which makes
    // a demo relying on a quick reconnect look "stuck".
    res.write('retry: 1000\n\n');

    const lastEventId = Number(req.headers['last-event-id'] ?? 0);

    for (const event of this.orderEvents.bufferedSince(orderId, lastEventId)) {
      writeSseEvent(res, event);
    }

    const subscription = this.orderEvents
      .streamFor(orderId)
      .subscribe(event => writeSseEvent(res, event));

    req.on('close', () => subscription.unsubscribe());
  }
}
