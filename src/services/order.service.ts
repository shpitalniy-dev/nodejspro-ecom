import { Injectable } from '@nestjs/common';

import { Order, OrderItem } from '../types/orders.types.ts';
import { Currencies } from '../types/types.ts';

import { ProductService } from './product.service.ts';

@Injectable()
export class OrderService {
  constructor(private readonly productService: ProductService) {}

  private readonly orders: Order[] = [];
  private nextId = 1;

  create(items: OrderItem[]): Order {
    const total_cents = items.reduce((sum, item) => {
      const product = this.productService.findById(item.productId);

      return sum + (product?.price_cents ?? 0) * item.quantity;
    }, 0);

    const order: Order = {
      id: this.nextId++,
      status: 'unpaid',
      total_cents,
      currency: Currencies.USD,
      items,
      created_at: new Date().toISOString(),
    };

    this.orders.push(order);

    return order;
  }

  findById(id: number): Order | undefined {
    return this.orders.find(order => order.id === id);
  }

  list(): Order[] {
    return this.orders;
  }
}
