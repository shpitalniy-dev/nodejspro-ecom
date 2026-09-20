import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { Inventory } from '../../src/entities/inventory.entity.ts';
import { OrderItem } from '../../src/entities/order-item.entity.ts';
import { encodeCursor } from '../../src/utils/cursor.ts';
import {
  anInventory,
  anOrder,
  aProduct,
  aUser,
} from '../integration/testkit/builders.ts';
import type { TestPg } from '../integration/testkit/postgres-container.ts';
import { startTestPostgres } from '../integration/testkit/postgres-container.ts';

import { startTestApp } from './testkit/app.ts';

// Full Nest app (Test.createTestingModule({ imports: [AppModule] }), no
// provider overrides), DB via testcontainers — the main feature
// (create -> read an order) plus one negative case, exactly as HW #16
// point 4 asks. Setup below inserts the product/stock directly via the
// DataSource (bypassing HTTP, same as the lecture's own step5) — only the
// order itself goes through supertest.
describe('Orders E2E (full Nest app, real postgres:17-alpine via testcontainers)', () => {
  let pg: TestPg;
  let app: INestApplication;

  beforeAll(async () => {
    pg = await startTestPostgres();
    app = await startTestApp(pg.container);
  }, 120000);

  afterAll(async () => {
    // App first, then the container — nothing should still be holding a
    // connection into a container that's about to stop.
    await app.close();
    await pg.stop();
  });

  test('happy path: create an order, then read it back', async () => {
    const product = await aProduct()
      .withPriceCents('2500')
      .insertVia(pg.dataSource.manager);

    await anInventory(product.id)
      .withQuantity(5)
      .insertVia(pg.dataSource.manager);

    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'e2e-happy-path-1') // required by the spec — omitting it is a 400 from express-openapi-validator, not from this test
      .send({ items: [{ productId: product.id, quantity: 1 }] })
      .expect(201);

    expect(created.body).toMatchObject({
      status: 'paid',
      total_cents: 2500,
      currency: 'USD',
      items: [{ productId: product.id, quantity: 1 }],
    });

    const fetched = await request(app.getHttpServer())
      .get(`/orders/${created.body.id}`)
      .expect(200);

    expect(fetched.body).toEqual(created.body);
  });

  test('multi-item: one order with two different products', async () => {
    const productA = await aProduct()
      .withPriceCents('1000')
      .insertVia(pg.dataSource.manager);

    await anInventory(productA.id)
      .withQuantity(5)
      .insertVia(pg.dataSource.manager);

    const productB = await aProduct()
      .withPriceCents('750')
      .insertVia(pg.dataSource.manager);

    await anInventory(productB.id)
      .withQuantity(5)
      .insertVia(pg.dataSource.manager);

    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'e2e-multi-item-1')
      .send({
        items: [
          { productId: productA.id, quantity: 2 },
          { productId: productB.id, quantity: 3 },
        ],
      })
      .expect(201);

    expect(created.body).toMatchObject({
      status: 'paid',
      total_cents: 1000 * 2 + 750 * 3,
      currency: 'USD',
    });
    expect(created.body.items).toEqual(
      expect.arrayContaining([
        { productId: productA.id, quantity: 2 },
        { productId: productB.id, quantity: 3 },
      ]),
    );
  });

  test('negative case: an unknown order id is a 404', async () => {
    await request(app.getHttpServer()).get('/orders/999999').expect(404);
  });

  // checkout()'s guarded balance UPDATE (WHERE balance_cents >= total)
  // rejects the whole order atomically rather than letting balance go
  // negative — the storefront customer is auto-created with a $1,000,000
  // balance (see orders.service.ts), so this needs a price above that to
  // actually trigger InsufficientFundsError, not just a big number.
  test('negative case: insufficient balance is a 409, balance stays untouched', async () => {
    const product = await aProduct()
      .withPriceCents('200000000') // $2,000,000 — more than the storefront customer's balance
      .insertVia(pg.dataSource.manager);

    await anInventory(product.id)
      .withQuantity(5)
      .insertVia(pg.dataSource.manager);

    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'e2e-insufficient-funds-1')
      .send({ items: [{ productId: product.id, quantity: 1 }] })
      .expect(409);

    expect(res.body.detail).toMatch(/insufficient funds/);

    // Rejected atomically — stock never moved either.
    const inventory = await pg.dataSource.manager
      .getRepository(Inventory)
      .findOneByOrFail({ product: { id: product.id } });

    expect(inventory.quantity).toBe(5);
  });

  // Same guard pattern as above, but on inventory.quantity instead of
  // balance_cents — the WHERE quantity >= $1 clause InventoryRepository
  // uses (HW #16 point 1's own tests already cover this at the repository
  // level; this confirms the same guard is reachable end-to-end through
  // the HTTP API).
  test('negative case: insufficient stock is a 409, order is never created', async () => {
    const product = await aProduct()
      .withPriceCents('100')
      .insertVia(pg.dataSource.manager);

    await anInventory(product.id)
      .withQuantity(1)
      .insertVia(pg.dataSource.manager);

    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'e2e-out-of-stock-1')
      .send({ items: [{ productId: product.id, quantity: 5 }] })
      .expect(409);

    expect(res.body.detail).toMatch(/out of stock/);

    // Rejected atomically — no OrderItem referencing this specific product
    // exists (checking by product identity, not by amount — a coincidental
    // amountCents match from some other order wouldn't prove anything).
    const orderItemCount = await pg.dataSource.manager
      .getRepository(OrderItem)
      .count({ where: { product: { id: product.id } } });

    expect(orderItemCount).toBe(0);
  });

  // Guards against a real TypeORM pitfall: leftJoinAndSelect on a to-many
  // relation (order.items) combined with take()/skip() applies the LIMIT
  // to joined rows, not distinct orders — an order with 2+ items landing
  // on a page could get its item list silently truncated. This creates a
  // real 2-item order (via checkout, so it has genuine OrderItem rows) and
  // confirms a list page including it returns both items, not one.
  test('an order with multiple items keeps all of them when listed, not just paginated by id', async () => {
    const productA = await aProduct()
      .withPriceCents('100')
      .insertVia(pg.dataSource.manager);

    await anInventory(productA.id)
      .withQuantity(5)
      .insertVia(pg.dataSource.manager);

    const productB = await aProduct()
      .withPriceCents('200')
      .insertVia(pg.dataSource.manager);

    await anInventory(productB.id)
      .withQuantity(5)
      .insertVia(pg.dataSource.manager);

    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'e2e-list-multi-item-1')
      .send({
        items: [
          { productId: productA.id, quantity: 1 },
          { productId: productB.id, quantity: 1 },
        ],
      })
      .expect(201);

    const { maxId: idBeforeThisOrder } = (await pg.dataSource.manager
      .createQueryBuilder()
      .select('COALESCE(MAX(o.id), 0)', 'maxId')
      .from('orders', 'o')
      .where('o.id < :id', { id: created.body.id })
      .getRawOne()) as { maxId: number };

    const listed = await request(app.getHttpServer())
      .get(
        `/orders?limit=1&cursor=${encodeURIComponent(encodeCursor(idBeforeThisOrder))}`,
      )
      .expect(200);

    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0].id).toBe(created.body.id);
    expect(listed.body.items[0].items).toHaveLength(2);
  });

  // Same app/container as every other test in this file — Jest isolates
  // module registries per test *file*, not per describe block, and
  // ConfigModule.forRoot() (inside AppModule, dynamically imported by
  // startTestApp()) only ever evaluates once per file: a second
  // startTestApp() call in this same file would reuse the first app's
  // already-baked-in env snapshot instead of picking up a new container's
  // connection info. So this reuses `app`/`pg` rather than starting its
  // own, and anchors its own cursor on the highest order id that existed
  // *before* it seeds anything, to stay independent of the orders the
  // tests above already created.
  test('limit + cursor walks through every page with no overlap or gap', async () => {
    const { maxId } = (await pg.dataSource.manager
      .createQueryBuilder()
      .select('COALESCE(MAX(o.id), 0)', 'maxId')
      .from('orders', 'o')
      .getRawOne()) as { maxId: number };

    const buyer = await aUser().insertVia(pg.dataSource.manager);
    const ids: number[] = [];

    for (let i = 0; i < 3; i++) {
      const order = await anOrder(buyer.id).insertVia(pg.dataSource.manager);

      ids.push(order.id);
    }

    const startCursor = encodeCursor(maxId);

    const page1 = await request(app.getHttpServer())
      .get(`/orders?limit=2&cursor=${encodeURIComponent(startCursor)}`)
      .expect(200);

    expect(page1.body.items.map((item: { id: number }) => item.id)).toEqual(
      ids.slice(0, 2),
    );
    expect(page1.body.next_cursor).not.toBeNull();

    const page2 = await request(app.getHttpServer())
      .get(
        `/orders?limit=2&cursor=${encodeURIComponent(page1.body.next_cursor)}`,
      )
      .expect(200);

    expect(page2.body.items.map((item: { id: number }) => item.id)).toEqual(
      ids.slice(2, 3),
    );
    expect(page2.body.next_cursor).toBeNull();
  });
});
