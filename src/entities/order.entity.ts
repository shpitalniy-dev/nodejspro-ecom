import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';

import { Fulfillment } from './fulfillment.entity.ts';
import { OrderItem } from './order-item.entity.ts';
import { User } from './user.entity.ts';

export type OrderStatus = 'unpaid' | 'pending' | 'paid' | 'refunded';

@Entity('orders')
@Check('discount_not_exceeding_amount', 'discount_cents <= amount_cents')
export class Order {
  @PrimaryGeneratedColumn('identity', {
    name: 'id',
    type: 'int',
    generatedIdentity: 'ALWAYS',
  })
  id!: number;

  @Index('orders_uuid_key', ['uuid'], { unique: true })
  @Column({ name: 'uuid', type: 'uuid', default: () => 'gen_random_uuid()' })
  uuid!: string;

  @Check('orders_currency_check', "currency IN ('USD')")
  @Column({ name: 'currency', type: 'text' })
  currency!: string;

  // bigint → string, same reasoning as Product.priceCents.
  @Check('orders_amount_cents_check', 'amount_cents >= 0')
  @Column({ name: 'amount_cents', type: 'bigint' })
  amountCents!: string;

  @Check('orders_discount_cents_check', 'discount_cents >= 0')
  @Column({ name: 'discount_cents', type: 'bigint', default: 0 })
  discountCents!: string;

  @Check(
    'orders_status_check',
    "status IN ('unpaid', 'pending', 'paid', 'refunded')",
  )
  @Column({ name: 'status', type: 'text', default: 'unpaid' })
  status!: OrderStatus;

  @ManyToOne(() => User, user => user.orders, {
    onDelete: 'RESTRICT',
    nullable: false,
  })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<User>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', nullable: true })
  updatedAt!: Date | null;

  @OneToMany(() => OrderItem, item => item.order)
  items?: Relation<OrderItem[]>;

  @OneToOne(() => Fulfillment, fulfillment => fulfillment.order)
  fulfillment?: Relation<Fulfillment>;
}
