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

import { Product } from './product.entity.ts';

@Entity('inventory')
export class Inventory {
  @PrimaryGeneratedColumn('identity', {
    name: 'id',
    type: 'int',
    generatedIdentity: 'ALWAYS',
  })
  id!: number;

  @Check('inventory_quantity_check', 'quantity >= 0')
  @Column({ name: 'quantity', type: 'int' })
  quantity!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', nullable: true })
  updatedAt!: Date | null;

  // CASCADE, unlike every other FK here: inventory is a product's own
  // attribute, meaningless without it, so a hard delete of the product takes
  // the inventory row with it. orders / order_items / fulfillments stay
  // RESTRICT because they're history that must survive a parent going away.
  @OneToOne(() => Product, product => product.inventory, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'product_id' })
  product!: Relation<Product>;
}
