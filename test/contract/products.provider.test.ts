import path from 'path';

import type { INestApplication } from '@nestjs/common';
import { Verifier } from '@pact-foundation/pact';

import { startTestApp } from '../e2e/testkit/app.ts';
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
        // The id travels as a provider state PARAMETER (set on the
        // consumer side via .given(state, { id })), not as a bare literal
        // in the request path — so this explicitly inserts the row with
        // that exact id rather than relying on "it's the only row in a
        // fresh container, so it happens to land on id 1" (which breaks
        // the moment a second interaction/state is added). Product.id is
        // GENERATED ALWAYS AS IDENTITY, so an explicit id insert needs
        // OVERRIDING SYSTEM VALUE — TypeORM's Repository.save() doesn't
        // add that clause, hence the raw query. ON CONFLICT DO NOTHING
        // per the spec's own hint, so re-running verification is safe.
        [`product with key ${CONTRACT_PRODUCT_KEY} exists`]:
          async parameters => {
            const { id } = parameters as { id: number };

            await pg.dataSource.manager.query(
              `INSERT INTO products (id, key, price_cents, currency)
             OVERRIDING SYSTEM VALUE
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (id) DO NOTHING`,
              [id, CONTRACT_PRODUCT_KEY, '1000', 'USD'],
            );
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
