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
  // BigInt end to end — cents is a SUM(...) aggregate, which pg returns as
  // a numeric string precisely so callers don't have to round-trip through
  // a float. Converting via Number() before dividing throws that guarantee
  // away right before display: past Number.MAX_SAFE_INTEGER the result
  // silently loses precision, the exact thing every money column in this
  // project is typed bigint/string to avoid.
  const value = BigInt(cents);

  return `$${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
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
