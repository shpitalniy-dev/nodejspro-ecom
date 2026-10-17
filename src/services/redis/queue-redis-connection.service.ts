import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.schema.ts';

import { RedisConnectionService } from './redis-connection.service.ts';

@Injectable()
export class QueueRedisConnection extends RedisConnectionService {
  constructor(config: ConfigService<Env, true>) {
    super(config.get('REDIS_QUEUE_URL', { infer: true }));
  }
}
