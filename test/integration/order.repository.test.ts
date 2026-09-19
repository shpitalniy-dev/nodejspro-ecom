import type { QueryRunner } from 'typeorm';

import { Order } from '../../src/entities/order.entity.ts';

import { anOrder, aUser } from './testkit/builders.ts';
import type { TestPg } from './testkit/postgres-container.ts';
import { startTestPostgres } from './testkit/postgres-container.ts';
import { beginTx, rollbackTx } from './testkit/tx.ts';

// Repo A — TypeORM's own Repository<Order> (manager.getRepository(Order)),
// used exactly as checkout.ts and seed.ts already use it. No new production
// code: these are the real constraints the `orders` table already enforces,
// which nothing built on top of a mock could ever fail.
describe('Order repository (testcontainers, real postgres:17-alpine)', () => {
  let pg: TestPg;
  let queryRunner: QueryRunner;
  let userId: number;

  beforeAll(async () => {
    pg = await startTestPostgres();
  }, 120000);

  afterAll(async () => {
    await pg.stop();
  });

  beforeEach(async () => {
    queryRunner = await beginTx(pg.dataSource);
    const user = await aUser().insertVia(queryRunner.manager);

    userId = user.id;
  });

  afterEach(async () => {
    await rollbackTx(queryRunner);
  });

  test('happy path: save an order, read it back', async () => {
    const saved = await anOrder(userId).insertVia(queryRunner.manager);

    const found = await queryRunner.manager
      .getRepository(Order)
      .findOneByOrFail({ id: saved.id });

    expect(found).toMatchObject({ currency: 'USD', amountCents: '1999' });
  });

  test('unique constraint: a duplicate uuid is rejected (orders_uuid_key)', async () => {
    const uuid = '00000000-0000-4000-8000-000000000001';

    await anOrder(userId).withUuid(uuid).insertVia(queryRunner.manager);

    await expect(
      anOrder(userId).withUuid(uuid).insertVia(queryRunner.manager),
    ).rejects.toMatchObject({ code: '23505' }); // duplicate key value violates unique constraint
  });

  test('foreign key constraint: an unknown user is rejected (RESTRICT FK)', async () => {
    await expect(
      anOrder(999999).insertVia(queryRunner.manager),
    ).rejects.toMatchObject({ code: '23503' }); // violates foreign key constraint
  });

  test('check constraint: discount exceeding amount is rejected', async () => {
    await expect(
      anOrder(userId)
        .withAmountCents('1000')
        .withDiscountCents('2000')
        .insertVia(queryRunner.manager),
    ).rejects.toMatchObject({ code: '23514' }); // violates check constraint "discount_not_exceeding_amount"
  });
});
