import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import type { Env } from '../../config/env.schema.ts';

// Lazy, like DataSourceService and RabbitMqService: the app boots and
// `--wait` passes even when Redis is down. Only the first caller that needs
// a connection opens one.
@Injectable()
export class RedisCacheService implements OnModuleDestroy {
  private client: Redis | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {}

  getClient(): Promise<Redis> {
    this.client ??= new Redis(this.config.get('REDIS_URL', { infer: true }));

    return Promise.resolve(this.client);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }
}
