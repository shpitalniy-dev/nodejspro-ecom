import type { RedisOptions } from 'ioredis';
import { Redis } from 'ioredis';

export function createRedisClient(
  url: string,
  options: RedisOptions = {},
): Redis {
  return new Redis(url, options);
}
