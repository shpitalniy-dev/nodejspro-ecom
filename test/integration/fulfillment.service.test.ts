import type { QueryRunner } from 'typeorm';

import { FulfillmentService } from '../../src/controllers/fulfillment/fulfillment.service.ts';
import { InboxService } from '../../src/services/inbox.service.ts';
import {
  getPgErrorCode,
  isForeignKeyViolation,
} from '../../src/utils/pg-error.ts';

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
  const fulfillment = new FulfillmentService(new InboxService());

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

  // Same messageId on both calls — a redelivery is literally the same
  // message, so this is the faithful simulation of it. It also exercises
  // the inbox (level 2) dedup first: processed_messages already has a row
  // for 'evt-1' by the second call, so that call never even reaches the
  // fulfillments insert — the SQL cross-check below still pins the result.
  test('first delivery applies the effect, a redelivery is a duplicate and adds no row', async () => {
    await expect(
      fulfillment.applyFulfillment(queryRunner.manager, orderId, 'evt-1'),
    ).resolves.toBe('applied');
    await expect(
      fulfillment.applyFulfillment(queryRunner.manager, orderId, 'evt-1'),
    ).resolves.toBe('duplicate');

    const [{ count }] = await queryRunner.manager.query(
      'SELECT count(*)::int AS count FROM fulfillments WHERE order_id = $1',
      [orderId],
    );

    expect(count).toBe(1);
  });

  test('an unknown order is a foreign key violation (23503), which the consumer treats as permanent', async () => {
    const error = await fulfillment
      .applyFulfillment(queryRunner.manager, 999999, 'evt-2')
      .then(
        () => undefined,
        (e: unknown) => e,
      );

    expect(isForeignKeyViolation(error)).toBe(true);
    expect(getPgErrorCode(error)).toBe('23503');
  });
});
