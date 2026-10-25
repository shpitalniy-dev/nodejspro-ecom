import { Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import type { RotatedRefreshToken } from './auth.types.ts';

// Lets a request that loses the rotation race (see refresh-token.service.ts's
// rotate()) fetch the SAME pair the winner already minted, instead of being
// told to regenerate one — there's nothing to regenerate from, a rotated
// token's replacement is genuinely random. No locking needed on the write
// side: only the single request that won the DB claim for a given row ever
// writes that row's key, so there's no concurrent-writer case here.
const keyFor = (oldTokenId: number): string => `refresh-grace:${oldTokenId}`;

@Injectable()
export class RefreshGraceCacheService {
  constructor(private readonly redis: Redis) {}

  async set(
    oldTokenId: number,
    result: RotatedRefreshToken,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.set(
      keyFor(oldTokenId),
      JSON.stringify(result),
      'EX',
      ttlSeconds,
    );
  }

  async get(oldTokenId: number): Promise<RotatedRefreshToken | null> {
    const raw = await this.redis.get(keyFor(oldTokenId));

    return raw ? (JSON.parse(raw) as RotatedRefreshToken) : null;
  }
}
