import 'reflect-metadata';

import { DataSource, LessThan } from 'typeorm';

import { dataSourceOptions } from '../data-source.ts';
import { Inventory } from '../entities/inventory.entity.ts';
import { Product } from '../entities/product.entity.ts';
import { User } from '../entities/user.entity.ts';

import { checkout, OutOfStockError } from './checkout.ts';

// 50+ concurrent checkouts on one product with a known stock, no
// application-level queueing — the thing being proven is that the atomic
// `UPDATE ... WHERE quantity >= $n RETURNING` in checkout.ts (not an
// app-side lock or semaphore) is what prevents oversell under real
// concurrency. See README's Concurrency section for the full numbers.
//
// Everything here but checkout() itself is plain, non-concurrent setup and
// teardown — lookups and resets that run once, sequentially, before the
// real concurrent part starts. None of it needs raw SQL the way checkout's
// atomic decrement does, so it's all ordinary Repository calls.

const RACE_BUYER_EMAIL = 'demo-buyer@seed.example';
const RACE_PRODUCT_KEY = 'sku-concurrency-demo';
const ATTEMPTS = 50;
const INITIAL_STOCK = 10;
const BUYER_BASELINE_BALANCE_CENTS = '100000'; // $1,000 — never the bottleneck

async function main(): Promise<void> {
  // Own DataSource, own pool — pg's default `max: 10` would just queue 40 of
  // the 50 clients rather than run them concurrently. Bumping it here is
  // what makes this a genuine concurrency test, not a serialized one.
  const ds = new DataSource({ ...dataSourceOptions, extra: { max: 60 } });

  await ds.initialize();

  try {
    const buyer = await ds
      .getRepository(User)
      .findOneBy({ email: RACE_BUYER_EMAIL });
    const product = await ds
      .getRepository(Product)
      .findOneBy({ key: RACE_PRODUCT_KEY });

    if (!buyer || !product) {
      throw new Error(
        `demo fixtures missing — run \`npm run seed\` first (needs ${RACE_BUYER_EMAIL} / ${RACE_PRODUCT_KEY})`,
      );
    }

    const inventory = await ds
      .getRepository(Inventory)
      .findOneBy({ product: { id: product.id } });

    if (!inventory) {
      throw new Error(`no inventory row for ${RACE_PRODUCT_KEY}`);
    }

    // Reset to a known baseline so this demo is rerunnable without reseeding.
    await ds
      .getRepository(User)
      .update(buyer.id, { balanceCents: BUYER_BASELINE_BALANCE_CENTS });
    await ds
      .getRepository(Inventory)
      .update(inventory.id, { quantity: INITIAL_STOCK });

    console.log(
      `demo:race — ${ATTEMPTS} concurrent checkouts, stock reset to ${INITIAL_STOCK}\n`,
    );

    // Promise.allSettled, not Promise.all: ~40 of these 50 calls are
    // *expected* to reject once stock hits zero. Promise.all would abort the
    // whole batch on the first rejection instead of letting us tally every
    // outcome — Promise.allSettled keeps the "fire all 50 at once, no
    // app-level queue" property the assignment actually cares about while
    // still collecting every result.
    const results = await Promise.allSettled(
      Array.from({ length: ATTEMPTS }, () =>
        checkout(ds, {
          userId: buyer.id,
          items: [{ productKey: RACE_PRODUCT_KEY, quantity: 1 }],
        }),
      ),
    );

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const outOfStock = results.filter(
      r => r.status === 'rejected' && r.reason instanceof OutOfStockError,
    ).length;
    const unexpected = results.filter(
      (r): r is PromiseRejectedResult =>
        r.status === 'rejected' && !(r.reason instanceof OutOfStockError),
    );

    const finalInventory = await ds
      .getRepository(Inventory)
      .findOneByOrFail({ id: inventory.id });
    const negativeStockRows = await ds
      .getRepository(Inventory)
      .countBy({ quantity: LessThan(0) });

    console.log(`attempts:            ${ATTEMPTS}`);
    console.log(`succeeded:           ${succeeded}`);
    console.log(`out of stock:        ${outOfStock}`);
    console.log(`unexpected errors:   ${unexpected.length}`);
    console.log(`final stock:         ${finalInventory.quantity}`);
    console.log(`negative-stock rows: ${negativeStockRows}\n`);

    if (unexpected.length > 0) {
      console.error('unexpected errors:');
      for (const r of unexpected) console.error(' -', r.reason);
    }

    const ok =
      succeeded === INITIAL_STOCK &&
      finalInventory.quantity === 0 &&
      negativeStockRows === 0 &&
      unexpected.length === 0;

    if (ok) {
      console.log(
        'invariant check passed — no oversell, no lost updates, no unexpected errors',
      );
    } else {
      console.error('invariant check FAILED');
      process.exitCode = 1;
    }
  } finally {
    await ds.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
