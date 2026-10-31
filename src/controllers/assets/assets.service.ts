import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { createHash } from 'node:crypto';

import type { Env } from '../../config/env.schema.ts';
import { S3ClientService } from '../../services/storage/s3-client.service.ts';

import { assetCacheKey, parseMaxAge } from './assets.utils.ts';

export interface CachedAsset {
  body: Buffer;
  contentType: string;
  cacheControl: string;
}

interface CacheEnvelope {
  contentType: string;
  cacheControl: string;
  body: string; // base64
}

// Closed-bucket, open-cache (HW #26 slice 3): this service is the only
// thing that ever reads STORAGE_BUCKET_ASSETS directly — a real storage
// credential, not a reverse proxy in front of a public endpoint, same
// principle CloudFront's OAC enforces with a bucket policy instead.
@Injectable()
export class AssetsService {
  private readonly bucket: string;

  constructor(
    private readonly redis: Redis,
    private readonly s3: S3ClientService,
    config: ConfigService<Env, true>,
  ) {
    this.bucket = config.get('STORAGE_BUCKET_ASSETS', { infer: true });
  }

  // Redis, not an in-memory Map — shared across every instance of this
  // API, same reasoning HW #23's token-bucket/cache-aside services
  // already rely on. What makes this an "edge" cache and not just another
  // one of those isn't the storage technology, it's that nothing ever
  // calls an equivalent of CacheAsideService's invalidate() on it: a
  // content-hashed key is only ever superseded by a different key, never
  // updated in place, so there's no write path that needs to evict it.
  //
  // 🔴 Known limitation, not a hidden one: this caches the FULL object
  // body in Redis. Fine for what this slice actually publishes (small,
  // hot, infrequently-updated static assets — the realistic case for a
  // Redis-backed cache), but it doesn't scale to large media the way a
  // real CDN edge does. Redis is in-memory, so every cached asset's bytes
  // compete for RAM against everything else sharing this same connection
  // (HW #23's rate limiter, sessions, product cache) — a real CDN's edge
  // nodes are disk-backed specifically so object size isn't a RAM-budget
  // problem. A production version serving large files should either cap
  // what this cache will hold by size (falling through to a direct,
  // uncached fetch above some threshold) or not put a Redis tier in front
  // of large media at all, relying on a real CDN/object-storage-direct
  // path instead.
  async get(
    key: string,
  ): Promise<(CachedAsset & { cacheHit: boolean }) | null> {
    const cached = await this.redis.get(assetCacheKey(key));

    if (cached) {
      const envelope = JSON.parse(cached) as CacheEnvelope;

      return {
        body: Buffer.from(envelope.body, 'base64'),
        contentType: envelope.contentType,
        cacheControl: envelope.cacheControl,
        cacheHit: true,
      };
    }

    let head;

    try {
      head = await this.s3.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch {
      return null;
    }

    const body = head.Body
      ? Buffer.from(await head.Body.transformToByteArray())
      : Buffer.alloc(0);
    const contentType = head.ContentType ?? 'application/octet-stream';
    const cacheControl = head.CacheControl ?? '';
    const maxAge = parseMaxAge(cacheControl);

    if (maxAge !== null) {
      const envelope: CacheEnvelope = {
        contentType,
        cacheControl,
        body: body.toString('base64'),
      };

      await this.redis.set(
        assetCacheKey(key),
        JSON.stringify(envelope),
        'EX',
        maxAge,
      );
    }

    return { body, contentType, cacheControl, cacheHit: false };
  }

  // Models a build/deploy step, not a user upload — never exposed over
  // HTTP; demo:cdn calls this directly through the app's DI container.
  // `name` is the caller's own logical asset name (e.g. "app", "vendor") —
  // only the hash changes between versions of the SAME name, same shape
  // a real bundler's own content-hashed output uses (app.[contenthash].js,
  // vendor.[contenthash].js, ...). Without it every asset would collide
  // into the same app.<hash>.<ext> pattern regardless of what it actually is.
  async publish(
    name: string,
    content: Buffer,
    contentType: string,
    ext: string,
  ): Promise<{ key: string }> {
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 8);
    const key = `${name}.${hash}.${ext}`;

    await this.s3.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: content,
        ContentType: contentType,
        // Immutable, content-hashed name: the only mechanism this slice
        // needs for "updates without invalidation" — new content gets a
        // new key, and the old key's OBJECT is never deleted or expired by
        // anything in this service (no lifecycle rule on this bucket — see
        // garage-init.mjs), so it keeps serving the old bytes indefinitely.
        // max-age here only bounds the Redis CACHE COPY's own TTL, not the
        // origin object's lifetime — a cache miss after that just re-fetches
        // the still-intact object and re-caches it, it doesn't mean the old
        // version became unavailable.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    return { key };
  }
}
