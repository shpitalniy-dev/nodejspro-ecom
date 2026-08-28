import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';

import { IdempotencyKeyInterceptor } from '../../interceptors/idempotency-key.interceptor.ts';
import { LocationHeaderInterceptor } from '../../interceptors/location-header.interceptor.ts';
import { OrderService } from '../../services/order.service.ts';
import type { CreateOrderBody } from '../../types/orders.types.ts';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orderService: OrderService) {}

  @Get()
  list(
    @Query('limit', ParseIntPipe) _limit: number,
    @Query('cursor') _cursor: string,
  ) {
    return { items: this.orderService.list(), next_cursor: null };
  }

  @Post()
  @HttpCode(201)
  @UseInterceptors(LocationHeaderInterceptor, IdempotencyKeyInterceptor)
  create(@Body() body: CreateOrderBody) {
    return this.orderService.create(body.items);
  }

  @Get(':orderId')
  getOne(@Param('orderId', ParseIntPipe) orderId: number) {
    const order = this.orderService.findById(orderId);

    if (!order) {
      throw new NotFoundException({
        title: 'Order not found',
        detail: `Order "${orderId}" not found.`,
      });
    }

    return order;
  }
}
