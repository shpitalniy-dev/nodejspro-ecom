import type { DataSource } from 'typeorm';

import { Order } from '../entities/order.entity.ts';
import { OrderItem } from '../entities/order-item.entity.ts';
import { Product } from '../entities/product.entity.ts';
import { Task } from '../entities/task.entity.ts';

// The core "buy now" operation: decrement balance, decrement stock, record
// the order, queue its post-processing task — all in one transaction, or
// none of it. Deliberately plain READ COMMITTED (the default): every check
// that has to be race-safe is a single atomic `UPDATE ... WHERE ... >= $n
// RETURNING` statement (or, for the price, a value looked up fresh inside
// that same statement — see the balance decrement below), so there's no
// separate read step for a concurrent checkout — or a concurrent price
// change — to race against, and no need for FOR UPDATE or a higher
// isolation level. See README's Concurrency section for the fuller
// justification.

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
    // Plain, unlocked lookup — only for id/currency/key, none of which this
    // system ever changes concurrently the way price can. The price itself
    // is deliberately NOT read here: using it for amountCents would be the
    // exact stale-price race this function has to avoid (a concurrent
    // price change landing between this read and the balance decrement
    // below). See that decrement for where the real price comes from.
    const product = await manager
      .getRepository(Product)
      .findOneBy({ key: productKey });

    if (!product) {
      throw new UnknownProductError(productKey);
    }

    // Atomic balance decrement — and the price itself is looked up fresh
    // *inside this same statement* (a MATERIALIZED CTE, evaluated once),
    // not from the plain lookup above. Statement atomicity is what
    // protects it: nothing can change price_cents mid-statement, so this
    // needs no lock at all, and only for the duration of this one
    // statement rather than pessimistically locking `products` (shared,
    // frequently-read catalog data) for the rest of the transaction — the
    // same reasoning that already kept FOR UPDATE off the stock/balance
    // checks below, just extended to cover the price too.
    //
    // manager.query() on an UPDATE/DELETE always returns [rows, rowCount],
    // never a plain rows array — even with RETURNING (verified against
    // TypeORM's own PostgresQueryRunner.query(), which special-cases UPDATE
    // and DELETE to `raw = [raw.rows, raw.rowCount]`; a plain array only
    // happens for a SELECT-shaped command). Destructuring is required here:
    // checking .length on the un-destructured result checks the *tuple's*
    // length (always 2), so it never sees a real zero-rows case.
    const [balanceRows] = (await manager.query(
      `WITH current_price AS MATERIALIZED (
         SELECT price_cents FROM products WHERE id = $1
       )
       UPDATE users
       SET balance_cents = balance_cents
         - (SELECT price_cents FROM current_price) * $2
       WHERE id = $3
         AND balance_cents >= (SELECT price_cents FROM current_price) * $2
       RETURNING balance_cents, (SELECT price_cents FROM current_price) AS price_cents`,
      [product.id, quantity, userId],
    )) as [
      Array<{ balance_cents: string; price_cents: string | null }>,
      number,
    ];

    if (balanceRows.length === 0) {
      throw new InsufficientFundsError(userId);
    }

    const { price_cents: priceCents } = balanceRows[0];

    if (priceCents === null) {
      // The product row vanished between the lookup above and this
      // statement — every FK to products is RESTRICT, so this needs a
      // never-before-ordered product deleted in the exact window between
      // two statements of this same transaction. Vanishingly unlikely, but
      // a distinct error beats silently mis-reporting it as insufficient
      // funds.
      throw new UnknownProductError(productKey);
    }

    const amountCents = (BigInt(priceCents) * BigInt(quantity)).toString();

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
      // The price actually charged (from the atomic decrement above), not
      // product.priceCents — that field on the plain lookup can be stale
      // the moment a concurrent price change lands.
      priceCents,
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
