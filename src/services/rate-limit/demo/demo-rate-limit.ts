import { Redis } from 'ioredis';
import type { ChildProcess } from 'node:child_process';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { requireEnv } from '../../../utils/require-env.ts';
import type { TokenBucketResult } from '../token-bucket.service.ts';
import { TokenBucketService } from '../token-bucket.service.ts';

// demo:ratelimit — token bucket on shared Redis storage (HW #23 point 4).

const INSTANCES = 2;
const CAPACITY = 5; // "limit"
// Deliberately tiny: whatever the demo's real wall-clock duration turns out
// to be, refill stays far under 1 token, so `allowed` is exactly CAPACITY
// regardless of timing — same determinism-over-realism choice already made
// for the cache-stampede demo's explicit DEL instead of forced LRU eviction.
const REFILL_PER_SECOND = 0.0001;
const REQUESTS_PER_INSTANCE = 8; // 16 total, 11 over capacity

interface ChildResult {
  allowed: number;
  blocked: number;
  lastRetryAfterSeconds: number;
}

async function runChild(key: string): Promise<void> {
  const redis = new Redis(requireEnv('REDIS_QUEUE_URL'));
  const bucket = new TokenBucketService(redis);

  try {
    let allowed = 0;
    let blocked = 0;
    let lastRetryAfterSeconds = 0;

    for (let i = 0; i < REQUESTS_PER_INSTANCE; i++) {
      const result: TokenBucketResult = await bucket.consume(key, {
        capacity: CAPACITY,
        refillPerSecond: REFILL_PER_SECOND,
      });

      if (result.allowed) {
        allowed++;
      } else {
        blocked++;
        lastRetryAfterSeconds = result.retryAfterSeconds;
      }
    }

    const report: ChildResult = { allowed, blocked, lastRetryAfterSeconds };
    const sent = process.send?.(report);

    if (!sent) {
      throw new Error('demo:ratelimit child has no IPC channel to its parent');
    }
  } finally {
    await redis.quit().catch(() => undefined);
  }
}

function forkChild(key: string): Promise<ChildResult> {
  const child: ChildProcess = fork(process.argv[1], [key], {
    env: process.env,
  });

  return new Promise((resolve, reject) => {
    child.once('message', message => resolve(message as ChildResult));
    child.once('error', reject);
    child.once('exit', code => {
      if (code !== 0) {
        reject(new Error(`demo:ratelimit child exited with code ${code}`));
      }
    });
  });
}

async function runParent(): Promise<void> {
  const key = `ratelimit:demo:${randomUUID()}`;
  const results = await Promise.all(
    Array.from({ length: INSTANCES }, () => forkChild(key)),
  );

  const allowed = results.reduce((sum, r) => sum + r.allowed, 0);
  const blocked = results.reduce((sum, r) => sum + r.blocked, 0);
  const lastRetryAfterSeconds = Math.max(
    ...results.map(r => r.lastRetryAfterSeconds),
  );

  const requests = INSTANCES * REQUESTS_PER_INSTANCE;
  const status = blocked > 0 ? 429 : 200;
  const retryAfter = lastRetryAfterSeconds >= 1 ? 1 : 0;

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
      'invariant check passed — shared bucket capped total allowed at the limit across independent processes',
    );
  } else {
    console.error('invariant check FAILED');
    process.exitCode = 1;
  }
}

const childKey = process.argv[2];

if (childKey) {
  runChild(childKey).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  runParent().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
