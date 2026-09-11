import type { DataSource } from 'typeorm';

import { Order } from '../entities/order.entity.ts';
import { OrderItem } from '../entities/order-item.entity.ts';
import { Product } from '../entities/product.entity.ts';
import { Task } from '../entities/task.entity.ts';

// The core "buy now" operation: decrement balance, decrement stock, record
// the order, queue its post-processing task — all in one transaction, or
// none of it. Deliberately plain READ COMMITTED (the default): both
// decrements are single atomic `UPDATE ... WHERE ... >= $n RETURNING`
// statements, so there's no separate read step for a concurrent checkout to
// race against and no need for FOR UPDATE or a higher isolation level. See
// README's Concurrency section for the fuller justification.

export class InsufficientFundsError extends Error {
  constructor(userId: number) {
    super(`insufficient funds: user ${userId}`);
    this.name = 'InsufficientFundsError';
  }
}

export class OutOfStockError extends Error {
  constructor(productKey: string) {
    super(`out of stock: ${productKey}`);
    this.name = 'OutOfStockError';
  }
}

export class UnknownProductError extends Error {
  constructor(productKey: string) {
    super(`unknown product: ${productKey}`);
    this.name = 'UnknownProductError';
  }
}

export interface CheckoutParams {
  userId: number;
  productKey: string;
  quantity: number;
}

export interface CheckoutResult {
  orderId: number;
  orderUuid: string;
}

// Post-processing isn't claimable right away — this window leaves room for
// a refund or an upsell on the same order (or another order from the same
// buyer) to land before fulfillment merges them, instead of shipping each
// order the moment it's paid. Computed by Postgres itself (raw SQL
// interval, not `new Date(Date.now() + ms)`) — the whole checkout already
// runs inside one DB transaction, so this shouldn't depend on the app
// server's clock agreeing with the database's; the worker's own claim
// query compares against the DB's now() too, so this keeps both sides of
// the comparison authored by the same clock.
const FULFILLMENT_DELAY_INTERVAL = "interval '2 hours'";

export async function checkout(
  dataSource: DataSource,
  { userId, productKey, quantity }: CheckoutParams,
): Promise<CheckoutResult> {
  return dataSource.transaction(async manager => {
    const product = await manager
      .getRepository(Product)
      .findOneBy({ key: productKey });

    if (!product) {
      throw new UnknownProductError(productKey);
    }

    const amountCents = (
      BigInt(product.priceCents) * BigInt(quantity)
    ).toString();

    // Atomic balance decrement: the WHERE clause is both the check and the
    // lock, with no window between them for a concurrent checkout to race
    // into — see README's Concurrency section for the full walkthrough.
    //
    // manager.query() on an UPDATE/DELETE always returns [rows, rowCount],
    // never a plain rows array — even with RETURNING (verified against
    // TypeORM's own PostgresQueryRunner.query(), which special-cases UPDATE
    // and DELETE to `raw = [raw.rows, raw.rowCount]`; a plain array only
    // happens for a SELECT-shaped command). Destructuring is required here:
    // checking .length on the un-destructured result checks the *tuple's*
    // length (always 2), so it never sees a real zero-rows case.
    const [balanceRows] = (await manager.query(
      `UPDATE users
       SET balance_cents = balance_cents - $1
       WHERE id = $2 AND balance_cents >= $1
       RETURNING balance_cents`,
      [amountCents, userId],
    )) as [Array<{ balance_cents: string }>, number];

    if (balanceRows.length === 0) {
      throw new InsufficientFundsError(userId);
    }

    // Same atomic pattern for stock — the one demo:race actually exercises
    // under real concurrency.
    const [stockRows] = (await manager.query(
      `UPDATE inventory
       SET quantity = quantity - $1
       WHERE product_id = $2 AND quantity >= $1
       RETURNING quantity`,
      [quantity, product.id],
    )) as [Array<{ quantity: number }>, number];

    if (stockRows.length === 0) {
      throw new OutOfStockError(productKey);
    }

    const order = await manager.getRepository(Order).save({
      currency: product.currency,
      amountCents,
      discountCents: '0',
      status: 'paid',
      user: { id: userId },
    });

    await manager.getRepository(OrderItem).save({
      key: product.key,
      currency: product.currency,
      priceCents: product.priceCents,
      quantity,
      product: { id: product.id },
      order: { id: order.id },
    });

    // .save() only accepts plain values, not raw SQL expressions — the
    // insert QueryBuilder is needed here specifically for availableAt's
    // `now() + interval` (see the comment on FULFILLMENT_DELAY_INTERVAL).
    await manager
      .createQueryBuilder()
      .insert()
      .into(Task)
      .values({
        type: 'order.fulfillment',
        payload: { orderId: order.id, orderUuid: order.uuid },
        availableAt: () => `now() + ${FULFILLMENT_DELAY_INTERVAL}`,
      })
      .execute();

    return { orderId: order.id, orderUuid: order.uuid };
  });
}
