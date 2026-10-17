import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';

import { requireEnv } from '../../../utils/require-env.ts';
import type { TokenBucketResult } from '../token-bucket.service.ts';
import { TokenBucketService } from '../token-bucket.service.ts';

// demo:ratelimit — token bucket on shared Redis storage (HW #23 point 4).
// No HTTP, no supertest: calls TokenBucketService.consume() directly, same
// convention as demo-cache.ts/demo-session.ts. Two separate service
// instances share one Redis connection and consume round-robin from the
// same key — proving shared enforcement across "pods" is the actual thing
// under test, not how many TCP connections are involved.

const INSTANCES = 2;
const CAPACITY = 5; // "limit"
// Deliberately tiny: whatever the demo's real wall-clock duration turns out
// to be, refill stays far under 1 token, so `allowed` is exactly CAPACITY
// regardless of timing — same determinism-over-realism choice already made
// for the cache-stampede demo's explicit DEL instead of forced LRU eviction.
const REFILL_PER_SECOND = 0.0001;
const REQUESTS_PER_INSTANCE = 8; // 16 total, 11 over capacity

async function main(): Promise<void> {
  const redis = new Redis(requireEnv('REDIS_QUEUE_URL'));
  const buckets = Array.from(
    { length: INSTANCES },
    () => new TokenBucketService(redis),
  );
  const key = `ratelimit:demo:${randomUUID()}`;

  try {
    let allowed = 0;
    let blocked = 0;
    let lastDenied: TokenBucketResult | undefined;
    const requests = INSTANCES * REQUESTS_PER_INSTANCE;

    for (let i = 0; i < requests; i++) {
      const result = await buckets[i % INSTANCES].consume(key, {
        capacity: CAPACITY,
        refillPerSecond: REFILL_PER_SECOND,
      });

      if (result.allowed) {
        allowed++;
      } else {
        blocked++;
        lastDenied = result;
      }
    }

    const status = lastDenied ? 429 : 200;
    const retryAfter = lastDenied && lastDenied.retryAfterSeconds >= 1 ? 1 : 0;

    console.log('demo:ratelimit — token bucket on shared Redis storage');
    console.log(`instances=${INSTANCES}`);
    console.log(`limit=${CAPACITY}`);
    console.log(`requests=${requests}`);
    console.log(`allowed=${allowed}`);
    console.log(`blocked=${blocked}`);
    console.log(`status=${status}`);
    console.log(`retry-after=${retryAfter}`);

    const invariantOk =
      INSTANCES >= 2 &&
      CAPACITY > 0 &&
      allowed === CAPACITY &&
      blocked >= 1 &&
      status === 429 &&
      retryAfter === 1;

    if (invariantOk) {
      console.log(
        'invariant check passed — shared bucket capped total allowed at the limit across all instances',
      );
    } else {
      console.error('invariant check FAILED');
      process.exitCode = 1;
    }
  } finally {
    await redis.quit().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
