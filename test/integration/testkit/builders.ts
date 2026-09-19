import type { DeepPartial, EntityManager } from 'typeorm';

import { Inventory } from '../../../src/entities/inventory.entity.ts';
import { Order } from '../../../src/entities/order.entity.ts';
import { Product } from '../../../src/entities/product.entity.ts';
import { User } from '../../../src/entities/user.entity.ts';

// One shared counter for every builder's default — "uniqueness is free"
// (user-1@example.com, user-2@..., sku-1, sku-2, ...), mirroring the
// lecture's aUser() builder.
let seq = 0;
const nextSeq = () => ++seq;

// `uuid` on User/Order is deliberately never set by a default here — both
// entities already have a real Postgres-side default (gen_random_uuid()),
// so a builder overriding it would hide a fact the schema already
// guarantees. `.withUuid()` still exists on OrderBuilder for the one test
// that needs to force a collision on purpose.

export class UserBuilder {
  private overrides: Partial<Pick<User, 'email' | 'name' | 'balanceCents'>> =
    {};

  withEmail(email: string): this {
    this.overrides.email = email;

    return this;
  }

  withBalanceCents(cents: string): this {
    this.overrides.balanceCents = cents;

    return this;
  }

  build(): DeepPartial<User> {
    return { email: `user-${nextSeq()}@example.com`, ...this.overrides };
  }

  insertVia(manager: EntityManager): Promise<User> {
    return manager.getRepository(User).save(this.build());
  }
}

export const aUser = (): UserBuilder => new UserBuilder();

export class ProductBuilder {
  private overrides: Partial<Pick<Product, 'key' | 'priceCents'>> = {};

  withKey(key: string): this {
    this.overrides.key = key;

    return this;
  }

  withPriceCents(cents: string): this {
    this.overrides.priceCents = cents;

    return this;
  }

  build(): DeepPartial<Product> {
    return {
      key: `sku-${nextSeq()}`,
      priceCents: '1000',
      currency: 'USD',
      ...this.overrides,
    };
  }

  insertVia(manager: EntityManager): Promise<Product> {
    return manager.getRepository(Product).save(this.build());
  }
}

export const aProduct = (): ProductBuilder => new ProductBuilder();

export class InventoryBuilder {
  private overrides: Partial<Pick<Inventory, 'quantity'>> = {};

  constructor(private readonly productId: number) {}

  withQuantity(quantity: number): this {
    this.overrides.quantity = quantity;

    return this;
  }

  build(): DeepPartial<Inventory> {
    return {
      product: { id: this.productId },
      quantity: 10,
      ...this.overrides,
    };
  }

  insertVia(manager: EntityManager): Promise<Inventory> {
    return manager.getRepository(Inventory).save(this.build());
  }
}

export const anInventory = (productId: number): InventoryBuilder =>
  new InventoryBuilder(productId);

export class OrderBuilder {
  private overrides: Partial<
    Pick<Order, 'uuid' | 'amountCents' | 'discountCents'>
  > = {};

  constructor(private readonly userId: number) {}

  withUuid(uuid: string): this {
    this.overrides.uuid = uuid;

    return this;
  }

  withAmountCents(cents: string): this {
    this.overrides.amountCents = cents;

    return this;
  }

  withDiscountCents(cents: string): this {
    this.overrides.discountCents = cents;

    return this;
  }

  build(): DeepPartial<Order> {
    return {
      currency: 'USD',
      amountCents: '1999',
      user: { id: this.userId },
      ...this.overrides,
    };
  }

  insertVia(manager: EntityManager): Promise<Order> {
    return manager.getRepository(Order).save(this.build());
  }
}

export const anOrder = (userId: number): OrderBuilder =>
  new OrderBuilder(userId);
