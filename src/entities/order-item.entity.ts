import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Order } from './order.entity.ts';
import { Product } from './product.entity.ts';

// The explicit join-entity for orders <-> products: it carries data on the
// relationship (quantity, price snapshot), so it's a real entity with two
// @ManyToOne sides, never @ManyToMany.
@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn('identity', {
    name: 'id',
    type: 'int',
    generatedIdentity: 'ALWAYS',
  })
  id!: number;

  // Snapshots of the product at purchase time — a later catalog change
  // can't rewrite what this line item actually was.
  @Column({ name: 'key', type: 'text' })
  key!: string;

  @Check('order_items_currency_check', "currency IN ('USD')")
  @Column({ name: 'currency', type: 'text' })
  currency!: string;

  @Column({ name: 'price_cents', type: 'bigint' })
  priceCents!: string;

  @Check('order_items_quantity_check', 'quantity > 0')
  @Column({ name: 'quantity', type: 'int' })
  quantity!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', nullable: true })
  updatedAt!: Date | null;

  @ManyToOne(() => Product, product => product.orderItems, {
    onDelete: 'RESTRICT',
    nullable: false,
  })
  @JoinColumn({ name: 'product_id' })
  product!: Product;

  @ManyToOne(() => Order, order => order.items, {
    onDelete: 'RESTRICT',
    nullable: false,
  })
  @JoinColumn({ name: 'order_id' })
  order!: Order;
}
