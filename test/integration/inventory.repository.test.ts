import type { QueryRunner } from 'typeorm';

import { Inventory } from '../../src/entities/inventory.entity.ts';
import { Product } from '../../src/entities/product.entity.ts';
import type { InventoryRepository } from '../../src/repositories/inventory.repository.ts';
import { createInventoryRepository } from '../../src/repositories/inventory.repository.ts';

import type { TestPg } from './testkit/postgres-container.ts';
import { startTestPostgres } from './testkit/postgres-container.ts';
import { beginTx, rollbackTx } from './testkit/tx.ts';

async function seedProduct(
  queryRunner: QueryRunner,
  key: string,
  quantity: number,
): Promise<number> {
  const product = await queryRunner.manager.getRepository(Product).save({
    key,
    priceCents: '1000',
    currency: 'USD',
  });

  await queryRunner.manager
    .getRepository(Inventory)
    .save({ product: { id: product.id }, quantity });

  return product.id;
}

// Repo B — InventoryRepository, extracted from checkout.ts's inline SQL.
// Covers the SQL-dependent behavior a mock can't verify: an atomic guarded
// UPDATE that depends on the row's real current state, and an aggregation
// over the whole table.
describe('InventoryRepository (testcontainers, real postgres:17-alpine)', () => {
  let pg: TestPg;
  let queryRunner: QueryRunner;
  let repo: InventoryRepository;

  beforeAll(async () => {
    pg = await startTestPostgres();
  }, 120000);

  afterAll(async () => {
    await pg.stop();
  });

  beforeEach(async () => {
    queryRunner = await beginTx(pg.dataSource);
    repo = createInventoryRepository(queryRunner.manager);
  });

  afterEach(async () => {
    await rollbackTx(queryRunner);
  });

  test('decrementStock succeeds when there is enough stock', async () => {
    const productId = await seedProduct(queryRunner, 'sku-widget', 10);

    const result = await repo.decrementStock(productId, 3);

    expect(result).toEqual({ quantity: 7 });
  });

  test('decrementStock returns null when stock is insufficient — the WHERE quantity >= $1 guard, unmockable', async () => {
    const productId = await seedProduct(queryRunner, 'sku-gadget', 2);

    const result = await repo.decrementStock(productId, 5);

    expect(result).toBeNull();

    const row = await queryRunner.manager
      .getRepository(Inventory)
      .findOneByOrFail({ product: { id: productId } });

    expect(row.quantity).toBe(2); // untouched — the guard blocked the write
  });

  test('totalQuantity aggregates stock across every product (SUM)', async () => {
    await seedProduct(queryRunner, 'sku-a', 10);
    await seedProduct(queryRunner, 'sku-b', 25);
    await seedProduct(queryRunner, 'sku-c', 0);

    await expect(repo.totalQuantity()).resolves.toBe(35);
  });
});
