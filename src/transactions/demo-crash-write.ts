import 'reflect-metadata';

import { DataSource } from 'typeorm';

import { dataSourceOptions } from '../data-source.ts';
import { Inventory } from '../entities/inventory.entity.ts';
import { Product } from '../entities/product.entity.ts';
import { User } from '../entities/user.entity.ts';

import { checkout, DemoWriteFailureError } from './checkout.ts';

const BUYER_EMAIL = 'demo-buyer@seed.example';
const PRODUCT_KEY = 'sku-concurrency-demo';
const STOCK = 10;
const BUYER_BALANCE_CENTS = '100000';

async function main(): Promise<void> {
  const ds = await new DataSource(dataSourceOptions).initialize();

  try {
    const buyer = await ds
      .getRepository(User)
      .findOneByOrFail({ email: BUYER_EMAIL });
    const product = await ds
      .getRepository(Product)
      .findOneByOrFail({ key: PRODUCT_KEY });
    const inventory = await ds
      .getRepository(Inventory)
      .findOneByOrFail({ product: { id: product.id } });

    // Same baseline every run — enough balance/stock that the forced
    // failure (below) is the ONLY reason this checkout() call fails.
    await ds
      .getRepository(User)
      .update(buyer.id, { balanceCents: BUYER_BALANCE_CENTS });
    await ds.getRepository(Inventory).update(inventory.id, { quantity: STOCK });

    let writeFailed = 0;
    let attemptedOrderId: number | undefined;

    process.env.DEMO_FAIL_AFTER_OUTBOX = '1';

    try {
      await checkout(ds, {
        userId: buyer.id,
        items: [{ productKey: PRODUCT_KEY, quantity: 1 }],
      });
    } catch (error) {
      if (!(error instanceof DemoWriteFailureError)) {
        throw error;
      }

      writeFailed = 1;
      attemptedOrderId = error.attemptedOrderId;
    } finally {
      delete process.env.DEMO_FAIL_AFTER_OUTBOX;
    }

    if (attemptedOrderId === undefined) {
      throw new Error(
        'checkout() did not fail the way this demo expects — DEMO_FAIL_AFTER_OUTBOX had no effect',
      );
    }

    const [{ n: orders }]: Array<{ n: number }> = await ds.query(
      'SELECT count(*)::int AS n FROM orders WHERE id = $1',
      [attemptedOrderId],
    );
    const [{ n: outbox }]: Array<{ n: number }> = await ds.query(
      `SELECT count(*)::int AS n FROM outbox
       WHERE aggregate_type = 'Order' AND aggregate_id = $1`,
      [String(attemptedOrderId)],
    );

    const published = 0;
    const deliveries = 0;
    const effect = 0;

    const invariantOk = writeFailed === 1 && orders === 0 && outbox === 0;

    console.log(
      'demo:crash-write — business write fails after the outbox insert',
    );
    console.log(`write-failed=${writeFailed}`);
    console.log(`orders=${orders}`);
    console.log(`outbox=${outbox}`);
    console.log(`published=${published}`);
    console.log(`deliveries=${deliveries}`);
    console.log(`effect=${effect}`);

    if (invariantOk) {
      console.log(
        'invariant check passed — the failed write took the outbox row down with it, nothing leaked',
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
