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

import { CreateOrderDto } from './orders.dto.ts';
import { OrdersService } from './orders.service.ts';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

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
}
