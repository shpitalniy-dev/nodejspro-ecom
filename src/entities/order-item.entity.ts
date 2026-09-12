import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';

import { Order } from './order.entity.ts';
import { Product } from './product.entity.ts';

// The explicit join-entity for orders <-> products: it carries data on the
// relationship (quantity, price snapshot), so it's a real entity with two
// @ManyToOne sides, never @ManyToMany.
//
// Postgres never indexes a foreign-key column automatically (unlike some
// other databases) — without these, every join through order_id/product_id
// (the N+1 fix's `relations`/`relationLoadStrategy` paths, report.ts's own
// joins) falls back to a seq scan the moment the table isn't tiny.
@Index('order_items_order_id_idx', ['order'])
@Index('order_items_product_id_idx', ['product'])
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
  product!: Relation<Product>;

  @ManyToOne(() => Order, order => order.items, {
    onDelete: 'RESTRICT',
    nullable: false,
  })
  @JoinColumn({ name: 'order_id' })
  order!: Relation<Order>;
}
