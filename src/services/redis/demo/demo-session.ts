import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';

import { requireEnv } from '../../../utils/require-env.ts';
import { sleep } from '../../../utils/sleep.ts';

// demo:session — a Redis-backed session with a rolling TTL (HW #23 point
// 3). No DB, no HTTP, no production SessionService: this project has no
// real auth yet (OrderOwnershipGuard's own comment defers that to HW #24),
// so there's nothing real to wire a session into without building auth
// early. This proves the Redis mechanics directly — create, read-and-renew,
// still-there-after — on the noeviction queue/session instance, never the
// allkeys-lru cache instance (which would silently evict it).

const SESSION_TTL_SECONDS = 60;
const WAIT_BETWEEN_REQUESTS_MS = 1500;
const REQUESTS = 4;

async function main(): Promise<void> {
  const redis = new Redis(requireEnv('REDIS_QUEUE_URL'));

  try {
    const sid = randomUUID();
    const key = `sess:${sid}`;

    // A session is nothing but a key with a TTL and a payload — no DB
    // involved, this demo is pure Redis mechanics.
    await redis.set(
      key,
      JSON.stringify({ userId: 1 }),
      'EX',
      SESSION_TTL_SECONDS,
    );

    let requests = 0;
    let ttlRenewed = false;

    for (let i = 0; i < REQUESTS; i++) {
      await sleep(WAIT_BETWEEN_REQUESTS_MS);

      const ttlBefore = await redis.ttl(key);
      // GETEX reads AND renews the TTL atomically
      await redis.getex(key, 'EX', SESSION_TTL_SECONDS);
      const ttlAfter = await redis.ttl(key);

      requests++;

      if (ttlAfter > ttlBefore) {
        ttlRenewed = true;
      }
    }

    const inRedis = (await redis.exists(key)) === 1 ? 1 : 0;

    console.log('demo:session — Redis-backed session with rolling TTL');
    console.log(`requests=${requests}`);
    console.log('sessions=1');
    console.log(`in-redis=${inRedis}`);
    console.log(`ttl-renewed=${ttlRenewed ? 1 : 0}`);

    const invariantOk = requests >= 3 && inRedis === 1 && ttlRenewed;

    if (invariantOk) {
      console.log(
        'invariant check passed — session lives in Redis and its TTL rolls forward on activity',
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
