import path from 'path';

import type { INestApplication } from '@nestjs/common';
import { Verifier } from '@pact-foundation/pact';

import { Product } from '../../src/entities/product.entity.ts';
import { startTestApp } from '../e2e/testkit/app.ts';
import { aProduct } from '../integration/testkit/builders.ts';
import type { TestPg } from '../integration/testkit/postgres-container.ts';
import { startTestPostgres } from '../integration/testkit/postgres-container.ts';

import { CONTRACT_PRODUCT_KEY } from './testkit/fixtures.ts';

describe('Pact provider verification: ecom-api against the contract', () => {
  let pg: TestPg;
  let app: INestApplication;
  let providerBaseUrl: string;

  beforeAll(async () => {
    pg = await startTestPostgres();
    app = await startTestApp(pg.container);
    await app.listen(0); // OS-assigned free port — Verifier needs a real listener

    const address = app.getHttpServer().address();

    if (typeof address !== 'object' || address === null) {
      throw new Error('expected app.listen(0) to bind a TCP port');
    }

    providerBaseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    await pg.stop();
  });

  test('all interactions in the local pact are verified', async () => {
    const brokerUrl = process.env.PACT_BROKER_URL;
    const pactFile = path.join(
      process.cwd(),
      'pacts',
      'storefront-web-ecom-api.json',
    );

    const output = await new Verifier({
      provider: 'ecom-api',
      providerBaseUrl,
      logLevel: 'info',
      stateHandlers: {
        // The container is fresh and this is the only row ever inserted
        // into it, so it deterministically gets id 1 (a plain identity
        // sequence starting at 1) — matching the consumer contract's
        // hardcoded path: '/products/1'. Product.id is GENERATED ALWAYS,
        // so an explicit id insert (the lecture's approach on a plain
        // column) would need OVERRIDING SYSTEM VALUE; relying on a fresh,
        // single-insert container avoids that entirely.
        [`product with key ${CONTRACT_PRODUCT_KEY} exists`]: async () => {
          const repo = pg.dataSource.manager.getRepository(Product);
          const existing = await repo.findOneBy({ key: CONTRACT_PRODUCT_KEY });

          if (!existing) {
            await aProduct()
              .withKey(CONTRACT_PRODUCT_KEY)
              .insertVia(pg.dataSource.manager);
          }
        },
      },
      ...(brokerUrl
        ? {
            pactBrokerUrl: brokerUrl,
            // Verifier rejects a pactBrokerToken key that's present but
            // undefined (it wants a non-empty string or no key at all) —
            // confirmed by running this against the local, no-auth broker
            // with PACT_BROKER_TOKEN unset. Only include it when it's
            // actually set.
            ...(process.env.PACT_BROKER_TOKEN
              ? { pactBrokerToken: process.env.PACT_BROKER_TOKEN }
              : {}),
            publishVerificationResult: true,
            providerVersion: process.env.PROVIDER_VERSION ?? '1.0.0',
            providerVersionBranch:
              process.env.PROVIDER_VERSION_BRANCH ?? 'main',
            consumerVersionSelectors: [{ latest: true }],
          }
        : { pactUrls: [pactFile] }),
    }).verifyProvider();

    console.log(output);
  });
});
