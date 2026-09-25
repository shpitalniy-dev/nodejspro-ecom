import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { aProduct } from '../integration/testkit/builders.ts';
import type { TestPg } from '../integration/testkit/postgres-container.ts';
import { startTestPostgres } from '../integration/testkit/postgres-container.ts';

import { startTestApp } from './testkit/app.ts';

describe('Products E2E — cursor pagination', () => {
  let pg: TestPg;
  let app: INestApplication;

  beforeAll(async () => {
    pg = await startTestPostgres();
    app = await startTestApp(pg.container);
  }, 120000);

  afterAll(async () => {
    await app.close();
    await pg.stop();
  });

  test('limit + cursor walks through every page with no overlap or gap', async () => {
    const ids: number[] = [];

    for (let i = 0; i < 5; i++) {
      const product = await aProduct().insertVia(pg.dataSource.manager);

      ids.push(product.id);
    }

    const page1 = await request(app.getHttpServer())
      .get('/products?limit=2')
      .expect(200);

    expect(page1.body.items.map((item: { id: number }) => item.id)).toEqual(
      ids.slice(0, 2),
    );
    expect(page1.body.next_cursor).not.toBeNull();

    const page2 = await request(app.getHttpServer())
      .get(
        `/products?limit=2&cursor=${encodeURIComponent(page1.body.next_cursor)}`,
      )
      .expect(200);

    expect(page2.body.items.map((item: { id: number }) => item.id)).toEqual(
      ids.slice(2, 4),
    );
    expect(page2.body.next_cursor).not.toBeNull();

    const page3 = await request(app.getHttpServer())
      .get(
        `/products?limit=2&cursor=${encodeURIComponent(page2.body.next_cursor)}`,
      )
      .expect(200);

    expect(page3.body.items.map((item: { id: number }) => item.id)).toEqual(
      ids.slice(4, 5),
    );
    expect(page3.body.next_cursor).toBeNull();
  });

  test('a garbage cursor is a 400', async () => {
    const res = await request(app.getHttpServer())
      .get('/products?cursor=not-a-real-cursor')
      .expect(400);

    expect(res.body.detail).toMatch(/cursor/);
  });
});
