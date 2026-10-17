import 'reflect-metadata';

import { Redis } from 'ioredis';
import { DataSource, In } from 'typeorm';

import type { Product } from '../../../controllers/products/products.types.ts';
import {
  jitteredProductTtlSeconds,
  productCacheKey,
  toApiProduct,
} from '../../../controllers/products/products.utils.ts';
import { dataSourceOptions } from '../../../data-source.ts';
import { Inventory } from '../../../entities/inventory.entity.ts';
import { Product as ProductEntity } from '../../../entities/product.entity.ts';
import { QueryCountLogger } from '../../../utils/query-count-logger.ts';
import { requireEnv } from '../../../utils/require-env.ts';
import { CacheAsideService } from '../cache-aside.service.ts';

// demo:cache — cache-aside with jittered TTL + single-flight stampede lock
// (HW #23). Two product sources, deliberately:
//   - 50 demo-only products ("cache-demo-N"), warmed through the SAME
//     production cache-aside path, to prove the jitter formula on real
//     writes rather than a synthetic loop — this is what `warmed` and
//     `ttl-distinct` measure.
//   - one real product from seed.ts ("sku-widget"), used for the actual
//     stampede assertion: warmed, explicitly made to vanish, then hit with
//     20+ concurrent readers — this is what `concurrent`/`db-calls`/
//     `db-calls-warm` measure.
// db-calls/db-calls-warm are counted honestly at the TypeORM Logger level
// (QueryCountLogger — real DB round-trips), not by incrementing a counter
// inside our own wrapper function.

const DEMO_PRODUCT_COUNT = 50;
const DEMO_KEY_PREFIX = 'cache-demo-';
const STAMPEDE_SEED_PRODUCT_KEY = 'sku-widget';
const CONCURRENT = 20;
const WARM_READ_COUNT = 100;

async function seedDemoProducts(ds: DataSource): Promise<ProductEntity[]> {
  const rows = Array.from({ length: DEMO_PRODUCT_COUNT }, (_, i) => ({
    key: `${DEMO_KEY_PREFIX}${i + 1}`,
    priceCents: String(1000 + i),
    currency: 'USD',
  }));

  // Same .insert().into(X).values().orIgnore() idiom seed.ts already uses
  // (ON CONFLICT DO NOTHING on the products_key_key unique index) — safe to
  // re-run every invocation, and the "cache-demo-" prefix keeps this
  // entirely disjoint from seed.ts's own "sku-*" products.
  await ds.manager
    .createQueryBuilder()
    .insert()
    .into(ProductEntity)
    .values(rows)
    .orIgnore()
    .execute();

  const products = await ds.manager
    .getRepository(ProductEntity)
    .find({ where: { key: In(rows.map(r => r.key)) } });

  await ds.manager
    .createQueryBuilder()
    .insert()
    .into(Inventory)
    .values(products.map(p => ({ product: { id: p.id }, quantity: 100 })))
    .orIgnore()
    .execute();

  return products;
}

async function loadProduct(
  ds: DataSource,
  id: number,
): Promise<Product | null> {
  const entity = await ds.manager
    .getRepository(ProductEntity)
    .findOneBy({ id });

  return entity ? toApiProduct(entity) : null;
}

async function main(): Promise<void> {
  const logger = new QueryCountLogger();
  const ds = new DataSource({
    ...dataSourceOptions,
    logging: ['query'],
    logger,
  });

  await ds.initialize();

  const redis = new Redis(requireEnv('REDIS_URL'));
  const cacheAside = new CacheAsideService(redis);

  try {
    const demoProducts = await seedDemoProducts(ds);
    const demoKeys = demoProducts.map(p => productCacheKey(p.id));
    const demoLockKeys = demoKeys.map(k => `lock:${k}`);

    // Clear this demo's own leftovers from a prior run — plain cleanup of
    // OWN keys at start, same convention every other demo in this repo
    // follows. Not the lock-release path, so a bare DEL is fine here.
    await redis.del(...demoKeys, ...demoLockKeys);

    console.log(
      'demo:cache — cache-aside with jittered TTL + single-flight stampede lock',
    );

    // Phase A — policy read straight off the cache connection. ioredis
    // types CONFIG GET loosely (it also covers GET's multi-pattern form);
    // the single-key form always returns a flat [name, value] pair.
    const [, policy] = (await redis.config(
      'GET',
      'maxmemory-policy',
    )) as unknown as string[];
    const [, maxmemoryRaw] = (await redis.config(
      'GET',
      'maxmemory',
    )) as unknown as string[];
    const cacheLru = policy !== 'noeviction' ? 1 : 0;
    const cacheMaxmemory = Number(maxmemoryRaw) > 0 ? 1 : 0;

    // Phase B — warm 50 real products through the real cache-aside path.
    for (const product of demoProducts) {
      await cacheAside.getOrLoad<Product | null>(
        productCacheKey(product.id),
        { ttlSeconds: jitteredProductTtlSeconds },
        () => loadProduct(ds, product.id),
      );
    }

    const warmedValues = await redis.mget(...demoKeys);
    const warmed = warmedValues.filter((v: string | null) => v !== null).length;
    const ttls = await Promise.all(demoKeys.map(k => redis.ttl(k)));
    const ttlDistinct = new Set(ttls).size;

    // Phase C — stampede on one just-vanished real seed.ts product. "Just
    // vanished" is an explicit DEL here, not a memory-pressure flood: the
    // lock's job is to handle a vanished key however it vanished, and this
    // is deterministic where forcing real LRU eviction would not be.
    const stampedeProduct = await ds.manager
      .getRepository(ProductEntity)
      .findOneByOrFail({ key: STAMPEDE_SEED_PRODUCT_KEY });
    const stampedeKey = productCacheKey(stampedeProduct.id);
    const stampedeLoader = (): Promise<Product | null> =>
      loadProduct(ds, stampedeProduct.id);

    await cacheAside.getOrLoad<Product | null>(
      stampedeKey,
      { ttlSeconds: jitteredProductTtlSeconds },
      stampedeLoader,
    );
    await redis.del(stampedeKey);

    logger.count = 0;
    await Promise.all(
      Array.from({ length: CONCURRENT }, () =>
        cacheAside.getOrLoad<Product | null>(
          stampedeKey,
          { ttlSeconds: jitteredProductTtlSeconds },
          stampedeLoader,
        ),
      ),
    );
    const dbCalls = logger.count;

    // Phase D — the cache is warm again: further reads must cost nothing.
    logger.count = 0;
    await Promise.all(
      Array.from({ length: WARM_READ_COUNT }, () =>
        cacheAside.getOrLoad<Product | null>(
          stampedeKey,
          { ttlSeconds: jitteredProductTtlSeconds },
          stampedeLoader,
        ),
      ),
    );
    const dbCallsWarm = logger.count;

    console.log(`cache-lru=${cacheLru}`);
    console.log(`cache-maxmemory=${cacheMaxmemory}`);
    console.log(`warmed=${warmed}`);
    console.log(`ttl-distinct=${ttlDistinct}`);
    console.log(`concurrent=${CONCURRENT}`);
    console.log(`db-calls=${dbCalls}`);
    console.log(`db-calls-warm=${dbCallsWarm}`);

    const invariantOk =
      cacheLru === 1 &&
      cacheMaxmemory === 1 &&
      warmed >= 50 &&
      ttlDistinct >= 5 &&
      CONCURRENT >= 20 &&
      dbCalls === 1 &&
      dbCallsWarm === 0;

    if (invariantOk) {
      console.log(
        'invariant check passed — policy set, jitter spreads TTLs, lock collapses the stampede to one DB call, warm cache costs nothing',
      );
    } else {
      console.error('invariant check FAILED');
      process.exitCode = 1;
    }
  } finally {
    await redis.quit().catch(() => undefined);
    await ds.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
