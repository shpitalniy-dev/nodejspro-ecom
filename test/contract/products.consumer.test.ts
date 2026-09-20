import path from 'path';

import { MatchersV3, PactV3 } from '@pact-foundation/pact';

import { CONTRACT_PRODUCT_KEY } from './testkit/fixtures.ts';

const { like } = MatchersV3;

describe('Pact consumer: storefront-web expects a product by id', () => {
  const provider = new PactV3({
    consumer: 'storefront-web',
    provider: 'ecom-api',
    dir: path.join(process.cwd(), 'pacts'),
  });

  test('GET /products/:id returns the product', async () => {
    provider
      .given(`product with key ${CONTRACT_PRODUCT_KEY} exists`)
      .uponReceiving('a request for that product')
      .withRequest({ method: 'GET', path: '/products/1' })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          id: like(1),
          key: like(CONTRACT_PRODUCT_KEY),
          price_cents: like(1000),
          currency: like('USD'),
          created_at: like('2024-01-01T00:00:00.000Z'),
        },
      });

    await provider.executeTest(async mockServer => {
      const res = await fetch(`${mockServer.url}/products/1`);

      expect(res.status).toBe(200);

      const body = (await res.json()) as { key: unknown };

      expect(typeof body.key).toBe('string');
    });
  });
});
