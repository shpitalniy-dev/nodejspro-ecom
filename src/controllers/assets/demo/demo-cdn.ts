import 'reflect-metadata';

import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

import type { Env } from '../../../config/env.schema.ts';
import { CacheRedisConnection } from '../../../services/redis/cache-redis-connection.service.ts';
import { S3ClientService } from '../../../services/storage/s3-client.service.ts';
import { startDemoApp } from '../../auth/demo/demo.utils.ts';
import { AssetsService } from '../assets.service.ts';
import { assetCacheKey } from '../assets.utils.ts';

// demo:cdn — closed bucket, cache in front, no invalidation (HW #26,
// slice 3). Proves two things a half-measure can't: a direct, anonymous
// request to storage is refused outright (not just "unlisted"), and a
// content update ships under a brand-new URL rather than needing anyone
// to tell a cache to forget the old one.
async function main(): Promise<void> {
  const app = await startDemoApp();
  const assetsService = app.app.get(AssetsService);
  const s3 = app.app.get(S3ClientService).client;
  const bucket = app.app
    .get(ConfigService<Env, true>)
    .get('STORAGE_BUCKET_ASSETS', { infer: true });
  const endpoint = app.app
    .get(ConfigService<Env, true>)
    .get('STORAGE_ENDPOINT', { infer: true });

  let keyA: string | undefined;
  let keyB: string | undefined;

  try {
    // Random per run — cheap insurance against a crashed prior run's
    // leftover object, same reasoning slices 1/2 got for free from
    // random uuids; here the key is content-derived, so the content
    // itself needs the per-run uniqueness instead.
    const marker = randomUUID();
    const contentA = Buffer.from(`body{color:red}   /* ${marker} */`);
    const contentB = Buffer.from(`body{color:blue}  /* ${marker} */`);

    const assetA = await assetsService.publish(
      'app',
      contentA,
      'text/css',
      'css',
    );
    keyA = assetA.key;

    // direct — anonymous GET straight at Garage's S3 API, bypassing the
    // app entirely. Path-style, same shape S3ClientService itself uses.
    const directRes = await fetch(`${endpoint}/${bucket}/${assetA.key}`);
    const direct = directRes.status;

    const edgeMissRes = await fetch(`${app.baseUrl}/assets/${assetA.key}`);
    const edgeHitRes = await fetch(`${app.baseUrl}/assets/${assetA.key}`);
    const cacheHit = edgeHitRes.headers.get('x-cache') === 'HIT' ? 1 : 0;
    const bodyA = await edgeHitRes.text();

    const assetB = await assetsService.publish(
      'app',
      contentB,
      'text/css',
      'css',
    );
    keyB = assetB.key;
    const newName = assetA.key !== assetB.key ? 1 : 0;

    const newUrlRes = await fetch(`${app.baseUrl}/assets/${assetB.key}`);
    const bodyB = await newUrlRes.text();
    const contentChanged = bodyA !== bodyB ? 1 : 0;

    console.log('demo:cdn — closed bucket, cache in front, no invalidation');
    console.log(`direct=${direct}`);
    console.log(`edge-miss=${edgeMissRes.status}`);
    console.log(`edge-hit=${edgeHitRes.status}`);
    console.log(`cache-hit=${cacheHit}`);
    console.log(`new-name=${newName}`);
    console.log(`new-url=${newUrlRes.status}`);
    console.log(`content-changed=${contentChanged}`);

    const invariantOk =
      direct === 403 &&
      edgeMissRes.status === 200 &&
      edgeHitRes.status === 200 &&
      cacheHit === 1 &&
      newName === 1 &&
      newUrlRes.status === 200 &&
      contentChanged === 1;

    if (invariantOk) {
      console.log(
        'invariant check passed — storage refuses anonymous reads, the cache serves repeat requests from itself, and new content arrives under a new URL with nothing to invalidate',
      );
    } else {
      console.error('invariant check FAILED');
      process.exitCode = 1;
    }
  } finally {
    const keys = [keyA, keyB].filter((key): key is string => key !== undefined);
    const redis = await app.app.get(CacheRedisConnection).getClient();
    const results = await Promise.allSettled([
      ...keys.map(key =>
        s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
      ),
      ...(keys.length > 0 ? [redis.del(...keys.map(assetCacheKey))] : []),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('[demo] asset cleanup failed:', result.reason);
      }
    }

    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
