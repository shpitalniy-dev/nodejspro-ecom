import { Redis } from 'ioredis';

// Single place that actually constructs an ioredis client — every
// connection this app opens (cache, queue, any future instance) goes
// through here, so connection options (retry strategy, TLS, ...) only ever
// need to change in one spot instead of once per connection class.
export function createRedisClient(url: string): Redis {
  return new Redis(url);
}
