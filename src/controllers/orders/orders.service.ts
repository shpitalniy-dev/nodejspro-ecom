import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { In } from 'typeorm';

import type { OrderStatus } from '../../entities/order.entity.ts';
import { Order as OrderEntity } from '../../entities/order.entity.ts';
import { Product as ProductEntity } from '../../entities/product.entity.ts';
import { User as UserEntity } from '../../entities/user.entity.ts';
import { DataSourceService } from '../../services/data-source.service.ts';
import {
  checkout,
  InsufficientFundsError,
  OutOfStockError,
} from '../../transactions/checkout.ts';
import { decodeCursor, encodeCursor } from '../../utils/cursor.ts';
import { mustGet } from '../../utils/must-get.ts';

import { OrderEventsService } from './order-events.service.ts';
import type { CreateOrderItemDto } from './orders.dto.ts';
import type { Order, OrderListResponse } from './orders.types.ts';
import { ORDER_RELATIONS, toApiOrder } from './orders.utils.ts';

// No auth yet (Architecture Note: "Auth lands at HW#24, not sooner") and
// CreateOrderRequest has no userId field (additionalProperties: false, so
// one can't be added without touching the HW #9 contract) — every order
// placed through this HTTP endpoint is attributed to one well-known
// placeholder customer, created on first use with a balance generous enough
// that InsufficientFundsError is never the reason a real request fails.
// Same kind of placeholder-actor pattern seed.ts already uses for its
// concurrency-demo buyer, just for the unauthenticated HTTP path.
const STOREFRONT_CUSTOMER_EMAIL = 'storefront@example.com';
const STOREFRONT_CUSTOMER_BALANCE_CENTS = '100000000';

@Injectable()
export class OrdersService {
  constructor(
    private readonly dataSourceService: DataSourceService,
    private readonly orderEvents: OrderEventsService,
  ) {}

  async list(limit = 20, cursor?: string): Promise<OrderListResponse> {
    const manager = await this.dataSourceService.getManager();
    const qb = manager
      .getRepository(OrderEntity)
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'items')
      .leftJoinAndSelect('items.product', 'product')
      // HW#18: toApiOrder() now always reads entity.user.id.
      .leftJoinAndSelect('order.user', 'user')
      .orderBy('order.id', 'ASC')
      .take(limit + 1); // one extra row, to know if there's a next page

    if (cursor) {
      qb.andWhere('order.id > :id', decodeCursor(cursor));
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: page.map(toApiOrder),
      next_cursor: hasMore ? encodeCursor(page[page.length - 1].id) : null,
    };
  }

  async findById(id: number): Promise<Order | undefined> {
    const manager = await this.dataSourceService.getManager();
    const order = await manager.getRepository(OrderEntity).findOne({
      where: { id },
      relations: ORDER_RELATIONS,
    });

    return order ? toApiOrder(order) : undefined;
  }

  // Lean lookup for OrderOwnershipGuard — only the two columns a WS join's
  // ownership check needs, not the full items/product graph findById loads.
  async getOwnerId(orderId: number): Promise<number | undefined> {
    const manager = await this.dataSourceService.getManager();
    const order = await manager.getRepository(OrderEntity).findOne({
      where: { id: orderId },
      relations: { user: true },
      select: { id: true, user: { id: true } },
    });

    return order?.user.id;
  }

  // HW#18's realtime status-change endpoint — no transition-validity rules
  // (any status to any status), since building an order state machine is
  // out of scope for this HW; the point here is the notification, not the
  // workflow. The room-emit is a side effect of this business-logic
  // method, never something OrdersController triggers directly.
  async updateStatus(orderId: number, status: OrderStatus): Promise<Order> {
    const manager = await this.dataSourceService.getManager();
    const result = await manager
      .getRepository(OrderEntity)
      .update({ id: orderId }, { status, updatedAt: new Date() });

    if (result.affected === 0) {
      throw new NotFoundException({
        title: 'Order not found',
        detail: `Order "${orderId}" not found.`,
      });
    }

    this.orderEvents.publish(orderId, status);

    const order = await this.findById(orderId);

    if (!order) {
      throw new Error(
        `order ${orderId} vanished immediately after its own status update`,
      );
    }

    return order;
  }

  async create(items: CreateOrderItemDto[]): Promise<Order> {
    const manager = await this.dataSourceService.getManager();

    const productIds = items.map(item => item.productId);
    const products = await manager
      .getRepository(ProductEntity)
      .findBy({ id: In(productIds) });
    const productById = new Map(products.map(product => [product.id, product]));

    const missing = items.find(item => !productById.has(item.productId));

    if (missing) {
      throw new BadRequestException({
        title: 'Unknown product',
        detail: `productId "${missing.productId}" does not exist.`,
      });
    }

    const customer = await this.getOrCreateStorefrontCustomer(manager);

    let result;

    try {
      result = await checkout(this.dataSourceService.dataSource, {
        userId: customer.id,
        items: items.map(item => ({
          productKey: mustGet(productById, item.productId).key,
          quantity: item.quantity,
        })),
      });
    } catch (error) {
      if (
        error instanceof OutOfStockError ||
        error instanceof InsufficientFundsError
      ) {
        throw new ConflictException({
          title: 'Order cannot be fulfilled',
          detail: (error as Error).message,
        });
      }

      throw error;
    }

    // checkout()'s transaction already committed by the time it resolves,
    // so this read-back always finds the order it just created.
    const order = await this.findById(result.orderId);

    if (!order) {
      throw new Error(
        `checkout() reported order ${result.orderId} created, but it can't be read back`,
      );
    }

    return order;
  }

  // Known race, not handled: two concurrent first requests could both see
  // "no existing customer" and both insert — the second loses to the
  // lower(email) unique index (23505). Acceptable for a single placeholder
  // actor with no real traffic pattern behind it yet.
  private async getOrCreateStorefrontCustomer(
    manager: EntityManager,
  ): Promise<UserEntity> {
    const repo = manager.getRepository(UserEntity);
    const existing = await repo.findOneBy({ email: STOREFRONT_CUSTOMER_EMAIL });

    if (existing) {
      return existing;
    }

    return repo.save({
      email: STOREFRONT_CUSTOMER_EMAIL,
      balanceCents: STOREFRONT_CUSTOMER_BALANCE_CENTS,
    });
  }
}
