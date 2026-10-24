import { Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

// Keyed by (iss, jti), never a hash of the token itself — a token-hash key
// is defeatable through JWS's own base64url/whitespace malleability; jti is
// a stable claim made exactly for this. Lives on redis-queue (HW #23's
// noeviction instance, same one TokenBucketService uses) — evicting a
// denylist entry under memory pressure would silently let a revoked token
// back in, which is the one failure mode this table must not have.
const keyFor = (iss: string, jti: string): string => `deny:${iss}:${jti}`;

@Injectable()
export class AccessDenylistService {
  constructor(private readonly redis: Redis) {}

  // Best-effort: a Redis hiccup here must not turn a successful logout into
  // a 500. The bounded cost of a missed write is the access token living
  // out its own already-short remaining TTL — nothing permanent, unlike
  // losing an outbox event.
  async deny(iss: string, jti: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) {
      return;
    }

    try {
      await this.redis.set(keyFor(iss, jti), '1', 'EX', ttlSeconds);
    } catch (error) {
      console.error('[access-denylist] write failed', error);
    }
  }

  // Fails open: a Redis error here is logged and treated as "not denied"
  // rather than rejecting every authenticated request in the app. The
  // denylist is an economy on top of an already-short access-token TTL,
  // not the primary auth boundary — that's the signature check in
  // AccessTokenService.verify(), which runs before this is ever reached.
  async isDenied(iss: string, jti: string): Promise<boolean> {
    try {
      return (await this.redis.exists(keyFor(iss, jti))) === 1;
    } catch (error) {
      console.error('[access-denylist] read failed, failing open', error);

      return false;
    }
  }
}
