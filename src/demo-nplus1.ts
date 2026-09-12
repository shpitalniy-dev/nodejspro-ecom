import 'reflect-metadata';

import type { Logger } from 'typeorm';
import { DataSource } from 'typeorm';

import { Order } from './entities/order.entity.ts';
import { OrderItem } from './entities/order-item.entity.ts';
import { Product } from './entities/product.entity.ts';
import { dataSourceOptions } from './data-source.ts';

// N+1, demonstrated on the real graph: orders -> order_items -> products.
// Same DB, three strategies, measured at two collection sizes (N = 3 and 8,
// the full seed) to prove the fixed strategies are flat, not just smaller.
// A third (or different) measurement point doesn't need a code change —
// pass sizes on the command line: npm run demo:nplus1 -- 3 8 20

const DEFAULT_SIZES = [3, 8];

function parseSizes(args: string[]): number[] {
  if (args.length === 0) {
    return DEFAULT_SIZES;
  }

  return args.map(arg => {
    const n = Number(arg);

    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`invalid size: "${arg}" (expected a positive integer)`);
    }

    return n;
  });
}

class QueryCountLogger implements Logger {
  count = 0;

  logQuery(): void {
    this.count++;
  }

  logQueryError(): void {}
  logQuerySlow(): void {}
  logSchemaBuild(): void {}
  logMigration(): void {}
  log(): void {}
}

// Result shape of the loadRelationIdAndMap() query below — it adds
// `productId` (the raw FK, no join) on top of OrderItem's own columns.
type OrderItemWithProductId = OrderItem & { productId: number };

// Naive: a query per element, at both levels — the realistic version of the
// bug (nothing eager-loaded, nested loops each triggering their own fetch).
// 1 (orders) + N (items, one query per order) + M (products, one query per
// item) queries total. loadRelationIdAndMap() gets each item's raw
// product_id in the same items query — no join, no extra round trip — so
// the naive part stays honest: a real per-product fetch, not a free one.
async function naive(ds: DataSource, take: number): Promise<void> {
  const orders = await ds
    .getRepository(Order)
    .find({ take, order: { id: 'ASC' } });

  const itemsByOrder: OrderItemWithProductId[][] = [];

  for (const order of orders) {
    const items = (await ds
      .getRepository(OrderItem)
      .createQueryBuilder('item')
      .where('item.order = :orderId', { orderId: order.id })
      .loadRelationIdAndMap('item.productId', 'item.product')
      .getMany()) as OrderItemWithProductId[];

    itemsByOrder.push(items);
  }

  for (const items of itemsByOrder) {
    for (const item of items) {
      await ds.getRepository(Product).findOneBy({ id: item.productId });
    }
  }
}

// Fix 1: default `join` relation-load strategy — one query, whatever N or M.
async function withRelations(ds: DataSource, take: number): Promise<void> {
  await ds.getRepository(Order).find({
    take,
    order: { id: 'ASC' },
    relations: { items: { product: true } },
  });
}

// Fix 2: `relationLoadStrategy: 'query'` — batched per relation level
// instead of one row-per-query, but still flat in N.
async function withQueryStrategy(ds: DataSource, take: number): Promise<void> {
  await ds.getRepository(Order).find({
    take,
    order: { id: 'ASC' },
    relations: { items: { product: true } },
    relationLoadStrategy: 'query',
  });
}

async function measure(
  logger: QueryCountLogger,
  fn: () => Promise<void>,
): Promise<number> {
  logger.count = 0;
  await fn();

  return logger.count;
}

async function main(): Promise<void> {
  const logger = new QueryCountLogger();
  const ds = new DataSource({
    ...dataSourceOptions,
    logging: ['query'],
    logger,
  });

  await ds.initialize();

  try {
    const sizes = parseSizes(process.argv.slice(2));
    const strategies: Array<{
      name: string;
      run: (take: number) => Promise<void>;
    }> = [
      { name: 'naive (query per element)', run: take => naive(ds, take) },
      {
        name: 'relations (join, default)',
        run: take => withRelations(ds, take),
      },
      {
        name: "relationLoadStrategy: 'query'",
        run: take => withQueryStrategy(ds, take),
      },
    ];

    console.log(
      `N+1 demo — orders -> order_items -> products (N = ${sizes.join(' / ')})\n`,
    );

    for (const strategy of strategies) {
      const counts: number[] = [];

      for (const n of sizes) {
        counts.push(await measure(logger, () => strategy.run(n)));
      }

      console.log(`  ${strategy.name.padEnd(30)} ${counts.join(' / ')}`);
    }
  } finally {
    await ds.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
