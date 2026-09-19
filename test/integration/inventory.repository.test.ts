import type { QueryRunner } from 'typeorm';

import { Inventory } from '../../src/entities/inventory.entity.ts';
import type { InventoryRepository } from '../../src/repositories/inventory.repository.ts';
import { createInventoryRepository } from '../../src/repositories/inventory.repository.ts';

import { anInventory, aProduct } from './testkit/builders.ts';
import type { TestPg } from './testkit/postgres-container.ts';
import { startTestPostgres } from './testkit/postgres-container.ts';
import { beginTx, rollbackTx } from './testkit/tx.ts';

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
    const product = await aProduct().insertVia(queryRunner.manager);

    await anInventory(product.id)
      .withQuantity(10)
      .insertVia(queryRunner.manager);

    const result = await repo.decrementStock(product.id, 3);

    expect(result).toEqual({ quantity: 7 });
  });

  test('decrementStock returns null when stock is insufficient — the WHERE quantity >= $1 guard, unmockable', async () => {
    const product = await aProduct().insertVia(queryRunner.manager);

    await anInventory(product.id)
      .withQuantity(2)
      .insertVia(queryRunner.manager);

    const result = await repo.decrementStock(product.id, 5);

    expect(result).toBeNull();

    const row = await queryRunner.manager
      .getRepository(Inventory)
      .findOneByOrFail({ product: { id: product.id } });

    expect(row.quantity).toBe(2); // untouched — the guard blocked the write
  });

  test('totalQuantity aggregates stock across every product (SUM)', async () => {
    for (const quantity of [10, 25, 0]) {
      const product = await aProduct().insertVia(queryRunner.manager);

      await anInventory(product.id)
        .withQuantity(quantity)
        .insertVia(queryRunner.manager);
    }

    await expect(repo.totalQuantity()).resolves.toBe(35);
  });
});
