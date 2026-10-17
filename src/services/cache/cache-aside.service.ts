import { Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';

import { sleep } from '../../utils/sleep.ts';

export interface CacheAsideOptions {
  ttlSeconds: number | (() => number);
  lockTtlMs?: number; // default 1000
  pollIntervalMs?: number; // default 50
  pollTimeoutMs?: number; // default 1000
}

const DEFAULT_LOCK_TTL_MS = 1000;
const DEFAULT_POLL_INTERVAL_MS = 50;
const DEFAULT_POLL_TIMEOUT_MS = 1000;

// Cache-aside + single-flight stampede lock (HW #23)
@Injectable()
export class CacheAsideService {
  constructor(private readonly redis: Redis) {}

  async getOrLoad<T>(
    key: string,
    opts: CacheAsideOptions,
    loader: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.redis.get(key);

    if (cached !== null) {
      return JSON.parse(cached) as T;
    }

    const lockKey = `lock:${key}`;
    const lockTtlMs = opts.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
    const token = randomUUID();
    const acquired = await this.redis.set(
      lockKey,
      token,
      'PX',
      lockTtlMs,
      'NX',
    );

    if (acquired === 'OK') {
      return this.runAsLeader(key, lockKey, token, opts, loader);
    }

    const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const deadline =
      Date.now() + (opts.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS);

    while (Date.now() < deadline) {
      await sleep(pollIntervalMs);
      const value = await this.redis.get(key);

      if (value !== null) {
        return JSON.parse(value) as T;
      }
    }

    return loader();
  }

  private async runAsLeader<T>(
    key: string,
    lockKey: string,
    token: string,
    opts: CacheAsideOptions,
    loader: () => Promise<T>,
  ): Promise<T> {
    try {
      const value = await loader();

      if (value !== null && value !== undefined) {
        const ttlSeconds =
          typeof opts.ttlSeconds === 'function'
            ? opts.ttlSeconds()
            : opts.ttlSeconds;

        await this.redis.set(
          key,
          JSON.stringify(value),
          'PX',
          ttlSeconds * 1000,
        );
      }

      return value;
    } finally {
      // Compare-and-delete: releases the lock ONLY if this token still owns
      // it. A bare DEL here would release a DIFFERENT caller's lock if ours
      // already expired and someone else took over in the meantime.
      await this.redis.call('DELEX', lockKey, 'IFEQ', token);
    }
  }
}
