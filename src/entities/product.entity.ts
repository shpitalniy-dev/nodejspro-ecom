import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Inventory } from './inventory.entity.ts';
import { OrderItem } from './order-item.entity.ts';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('identity', {
    name: 'id',
    type: 'int',
    generatedIdentity: 'ALWAYS',
  })
  id!: number;

  @Index('products_key_key', ['key'], { unique: true })
  @Column({ name: 'key', type: 'text' })
  key!: string;

  // pg returns bigint as a string — keeping the property a string avoids
  // silent precision loss above Number.MAX_SAFE_INTEGER, which is the whole
  // reason these columns are bigint and not int4 (see db/OPTIMIZATIONS.md).
  @Check('products_price_cents_check', 'price_cents >= 0')
  @Column({ name: 'price_cents', type: 'bigint' })
  priceCents!: string;

  // db/schema.sql models this as the currency_code DOMAIN; the entity uses
  // the equivalent text + CHECK so migration:generate stays clean — it
  // can't introspect a domain without flagging a diff on every run.
  @Check('products_currency_check', "currency IN ('USD')")
  @Column({ name: 'currency', type: 'text' })
  currency!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  // Set by the set_updated_at() BEFORE UPDATE trigger (added by hand to the
  // initial migration), never by the app — stays NULL until the first update.
  @Column({ name: 'updated_at', type: 'timestamptz', nullable: true })
  updatedAt!: Date | null;

  // Soft-delete marker. Plain column, not @DeleteDateColumn — we don't want
  // TypeORM's soft-delete query behaviour yet, just the column.
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @OneToOne(() => Inventory, inventory => inventory.product)
  inventory?: Inventory;

  @OneToMany(() => OrderItem, item => item.product)
  orderItems?: OrderItem[];
}
