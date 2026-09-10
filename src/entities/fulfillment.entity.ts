import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';

import { Order } from './order.entity.ts';

export type FulfillmentStatus =
  | 'pending'
  | 'processing'
  | 'shipped'
  | 'delivered';

@Entity('fulfillments')
export class Fulfillment {
  @PrimaryGeneratedColumn('identity', {
    name: 'id',
    type: 'int',
    generatedIdentity: 'ALWAYS',
  })
  id!: number;

  @Check(
    'fulfillments_status_check',
    "status IN ('pending', 'processing', 'shipped', 'delivered')",
  )
  @Column({ name: 'status', type: 'text', default: 'pending' })
  status!: FulfillmentStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', nullable: true })
  updatedAt!: Date | null;

  // One row per order, created when the order is paid — see the Architecture
  // Note in README. RESTRICT: a fulfillment record outlives interest in
  // deleting its order.
  @OneToOne(() => Order, order => order.fulfillment, {
    onDelete: 'RESTRICT',
    nullable: false,
  })
  @JoinColumn({ name: 'order_id' })
  order!: Relation<Order>;
}
