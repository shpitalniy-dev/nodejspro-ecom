import type { StartedRedisContainer } from '@testcontainers/redis';
import { RedisContainer } from '@testcontainers/redis';

export interface TestRedis {
  url: string;
  stop(): Promise<void>;
}

// One real Redis per test file, the same image docker-compose.yml runs.
// Shared for both REDIS_URL and REDIS_QUEUE_URL — nothing in the e2e/
// contract path exercises eviction-policy behavior (that's demo:cache's/
// demo:queue's own job, against the real compose instances); these tests
// only need CacheAsideService/TokenBucketService to have a connection that
// actually resolves, unlike the docker-compose-internal hostnames, which
// don't exist outside the compose network (and never will in CI).
export async function startTestRedis(): Promise<TestRedis> {
  const container: StartedRedisContainer = await new RedisContainer(
    'redis:8.4-alpine',
  ).start();

  return {
    url: container.getConnectionUrl(),
    stop: () => container.stop().then(() => undefined),
  };
}
