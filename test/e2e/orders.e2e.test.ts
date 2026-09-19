import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { anInventory, aProduct } from '../integration/testkit/builders.ts';
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
});
