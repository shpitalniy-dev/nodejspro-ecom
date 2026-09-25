import type { DataSource } from 'typeorm';
import { In } from 'typeorm';

import { Order } from '../entities/order.entity.ts';
import { OrderItem } from '../entities/order-item.entity.ts';
import { Product } from '../entities/product.entity.ts';
import { Task } from '../entities/task.entity.ts';
import { createInventoryRepository } from '../repositories/inventory.repository.ts';

// The core "buy now" operation: decrement balance, decrement stock, record
// the order (one or more line items), queue its post-processing task — all
// in one transaction, or none of it. Deliberately plain READ COMMITTED
// (the default): every check that has to be race-safe is a single atomic
// `UPDATE ... WHERE ... >= $n RETURNING` statement (or, for the price, a
// value looked up fresh inside that same statement — see the balance
// decrement below), so there's no separate read step for a concurrent
// checkout — or a concurrent price change — to race against, and no need
// for FOR UPDATE or a higher isolation level. See README's Concurrency
// section for the fuller justification.

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

export interface CheckoutItem {
  productKey: string;
  quantity: number;
}

export interface CheckoutParams {
  userId: number;
  items: CheckoutItem[];
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

interface PricedRow {
  product_id: number;
  key: string;
  currency: string;
  price_cents: string;
  quantity: number;
  balance_cents: string | null;
}

export async function checkout(
  dataSource: DataSource,
  { userId, items }: CheckoutParams,
): Promise<CheckoutResult> {
  return dataSource.transaction(async manager => {
    // Plain, unlocked lookup — only for existence, none of which this
    // system ever changes concurrently the way price can. Same role the
    // single-item version's own lookup always had, just batched via
    // In(...) instead of one findOneBy.
    const products = await manager
      .getRepository(Product)
      .findBy({ key: In(items.map(item => item.productKey)) });
    const productByKey = new Map(
      products.map(product => [product.key, product]),
    );

    const missing = items.find(item => !productByKey.has(item.productKey));

    if (missing) {
      throw new UnknownProductError(missing.productKey);
    }

    // ONE atomic statement charges the whole order: every line's price is
    // looked up fresh inside this same statement (never a separate read —
    // the exact stale-price race this function has always avoided), summed,
    // and the balance decremented once. unnest() zips the two parallel
    // arrays into rows — no hand-built SQL text, just two plain arrays as
    // parameters. `charge` is an inner-join gate: if its UPDATE's WHERE
    // doesn't match (insufficient balance), it produces zero rows and the
    // whole final SELECT returns zero rows too.
    //
    // This query's outermost statement is the trailing SELECT (the UPDATE
    // only exists inside the `charge` CTE), so — unlike a bare `UPDATE ...
    // RETURNING` — TypeORM's postgres driver reports this as SELECT-shaped
    // and returns a plain rows array, not a [rows, rowCount] tuple.
    const rows = (await manager.query(
      `WITH lines AS (
         SELECT * FROM unnest($1::text[], $2::int[]) AS t(product_key, quantity)
       ),
       priced AS MATERIALIZED (
         SELECT p.id AS product_id, p.key, p.currency, p.price_cents, l.quantity
         FROM lines l JOIN products p ON p.key = l.product_key
       ),
       totals AS MATERIALIZED (
         SELECT COALESCE(SUM(price_cents * quantity), 0) AS total_cents FROM priced
       ),
       charge AS (
         UPDATE users
         SET balance_cents = balance_cents - (SELECT total_cents FROM totals)
         WHERE id = $3 AND balance_cents >= (SELECT total_cents FROM totals)
         RETURNING balance_cents
       )
       SELECT priced.product_id, priced.key, priced.currency, priced.price_cents,
              priced.quantity, (SELECT balance_cents FROM charge) AS balance_cents
       FROM priced`,
      [
        items.map(item => item.productKey),
        items.map(item => item.quantity),
        userId,
      ],
    )) as PricedRow[];

    // Defensive fallback only — the plain lookup above already validated
    // every key exists, so this only fires if a product vanished in the
    // tiny window between that check and this statement (mirrors the
    // single-item version's own `priceCents === null` fallback). Still
    // reports the actually-missing key, not just "the first item."
    if (rows.length < items.length) {
      const foundKeys = new Set(rows.map(row => row.key));
      const missingLine = items.find(item => !foundKeys.has(item.productKey));

      throw new UnknownProductError(
        missingLine?.productKey ?? items[0].productKey,
      );
    }

    // Every row carries the same balance_cents (or the same null) — the
    // `charge` CTE's WHERE either matched for everyone or no one.
    if (rows[0].balance_cents === null) {
      throw new InsufficientFundsError(userId);
    }

    const totalCents = rows
      .reduce(
        (sum, row) => sum + BigInt(row.price_cents) * BigInt(row.quantity),
        0n,
      )
      .toString();

    // Same atomic guarded decrement per line — the one demo:race actually
    // exercises under real concurrency. Sequential within this one
    // transaction (not parallel — a single connection only runs one
    // statement at a time regardless): any single OutOfStockError rolls
    // back the whole order, the same all-or-nothing guarantee the
    // single-item version already had.
    for (const row of rows) {
      const stock = await createInventoryRepository(manager).decrementStock(
        row.product_id,
        row.quantity,
      );

      if (stock === null) {
        throw new OutOfStockError(row.key);
      }
    }

    const order = await manager.getRepository(Order).save({
      currency: rows[0].currency,
      amountCents: totalCents,
      discountCents: '0',
      status: 'paid',
      user: { id: userId },
    });

    await manager.getRepository(OrderItem).save(
      rows.map(row => ({
        key: row.key,
        currency: row.currency,
        // The price actually charged (from the atomic decrement above),
        // not a separately-read product price — that would be the exact
        // stale-price race this function has to avoid.
        priceCents: row.price_cents,
        quantity: row.quantity,
        product: { id: row.product_id },
        order: { id: order.id },
      })),
    );

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
