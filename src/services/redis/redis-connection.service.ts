import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { createRedisClient } from './redis.factory.ts';

// Lazy, like DataSourceService/RabbitMqService: the app boots and `--wait`
// passes even when Redis is down. Only the first caller that needs a
// connection opens one. Abstract base for CacheRedisConnection/
// QueueRedisConnection — those two differ only in which env var supplies
// the URL, so the URL is the only thing a subclass needs to provide.
@Injectable()
export abstract class RedisConnectionService implements OnModuleDestroy {
  private client: Redis | null = null;

  constructor(private readonly url: string) {}

  getClient(): Promise<Redis> {
    this.client ??= createRedisClient(this.url);

    return Promise.resolve(this.client);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }
}
