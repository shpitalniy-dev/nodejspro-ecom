import 'reflect-metadata';

import { OrderItem } from './entities/order-item.entity.ts';
import { AppDataSource } from './data-source.ts';

// Revenue by product, paid orders only — an aggregate report, not a domain
// shape, so this is createQueryBuilder().getRawMany(), not find(). See
// README's "Repository vs QueryBuilder" section for the general rule.
//
// Only `status = 'paid'` counts as realized revenue: unpaid/pending haven't
// been paid yet, and refunded had the money returned.
interface RevenueRow {
  productKey: string;
  lineItems: string; // COUNT(*) -> bigint -> pg returns it as a string
  unitsSold: string; // SUM(int) -> bigint -> same
  revenueCents: string; // SUM(bigint) -> numeric -> same
}

async function revenueByProduct(): Promise<RevenueRow[]> {
  return AppDataSource.createQueryBuilder()
    .select('product.key', 'productKey')
    .addSelect('COUNT(item.id)', 'lineItems')
    .addSelect('SUM(item.quantity)', 'unitsSold')
    .addSelect('SUM(item.priceCents * item.quantity)', 'revenueCents')
    .from(OrderItem, 'item')
    .innerJoin('item.product', 'product')
    .innerJoin('item.order', 'order')
    .where('order.status = :status', { status: 'paid' })
    .groupBy('product.id')
    .addGroupBy('product.key')
    .orderBy('"revenueCents"', 'DESC')
    .getRawMany<RevenueRow>();
}

function formatCents(cents: string): string {
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

async function main(): Promise<void> {
  await AppDataSource.initialize();

  try {
    const rows = await revenueByProduct();

    console.log('revenue by product (paid orders only)');

    for (const row of rows) {
      const units = `${row.unitsSold} unit${row.unitsSold === '1' ? '' : 's'}`;
      const lines = `${row.lineItems} line item${row.lineItems === '1' ? '' : 's'}`;

      console.log(
        `  ${row.productKey.padEnd(18)} ${units.padEnd(10)} ${formatCents(row.revenueCents).padStart(10)}   (${lines})`,
      );
    }
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
