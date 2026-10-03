import type { QueryRunner } from 'typeorm';

import { FulfillmentService } from '../../src/controllers/fulfillment/fulfillment.service.ts';

import { anOrder, aUser } from './testkit/builders.ts';
import type { TestPg } from './testkit/postgres-container.ts';
import { startTestPostgres } from './testkit/postgres-container.ts';
import { beginTx, rollbackTx } from './testkit/tx.ts';

// The idempotent effect of order.placed, against real postgres:17-alpine.
// Same ROLLBACK isolation as the repository tests. This also pins the shape
// manager.query() returns for INSERT ... RETURNING, which the effect relies on.
describe('FulfillmentService.applyFulfillment (testcontainers, real postgres:17-alpine)', () => {
  let pg: TestPg;
  let queryRunner: QueryRunner;
  let orderId: number;
  const fulfillment = new FulfillmentService();

  beforeAll(async () => {
    pg = await startTestPostgres();
  }, 120000);

  afterAll(async () => {
    await pg.stop();
  });

  beforeEach(async () => {
    queryRunner = await beginTx(pg.dataSource);

    const user = await aUser().insertVia(queryRunner.manager);
    const order = await anOrder(user.id).insertVia(queryRunner.manager);

    orderId = order.id;
  });

  afterEach(async () => {
    await rollbackTx(queryRunner);
  });

  test('first delivery applies the effect, a redelivery is a duplicate and adds no row', async () => {
    await expect(
      fulfillment.applyFulfillment(queryRunner.manager, orderId),
    ).resolves.toBe('applied');
    await expect(
      fulfillment.applyFulfillment(queryRunner.manager, orderId),
    ).resolves.toBe('duplicate');

    const [{ count }] = await queryRunner.manager.query(
      'SELECT count(*)::int AS count FROM fulfillments WHERE order_id = $1',
      [orderId],
    );

    expect(count).toBe(1);
  });

  test('an unknown order is a foreign key violation (23503), which the consumer treats as permanent', async () => {
    await expect(
      fulfillment.applyFulfillment(queryRunner.manager, 999999),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
  });
});
