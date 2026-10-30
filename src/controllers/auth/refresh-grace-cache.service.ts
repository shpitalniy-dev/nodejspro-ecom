import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';

import type { Env } from '../../config/env.schema.ts';

import type { RotatedRefreshToken } from './auth.types.ts';

// Lets a request that loses the rotation race (see refresh-token.service.ts's
// rotate()) fetch the SAME pair the winner already minted, instead of being
// told to regenerate one — there's nothing to regenerate from, a rotated
// token's replacement is genuinely random. No locking needed on the write
// side: only the single request that won the DB claim for a given row ever
// writes that row's key, so there's no concurrent-writer case here.
const keyFor = (oldTokenId: number): string => `refresh-grace:${oldTokenId}`;

const IV_LENGTH = 12; // standard GCM nonce size

@Injectable()
export class RefreshGraceCacheService {
  private readonly key: Buffer;

  constructor(
    private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    const pepper = config.get('REFRESH_TOKEN_PEPPER', { infer: true });

    this.key = createHmac('sha256', pepper)
      .update('refresh-grace-cache-aes-key-v1')
      .digest();
  }

  async set(
    oldTokenId: number,
    result: RotatedRefreshToken,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.set(
      keyFor(oldTokenId),
      this.encrypt(JSON.stringify(result)),
      'EX',
      ttlSeconds,
    );
  }

  async get(oldTokenId: number): Promise<RotatedRefreshToken | null> {
    const raw = await this.redis.get(keyFor(oldTokenId));

    if (!raw) {
      return null;
    }

    const plaintext = this.decrypt(raw);

    return plaintext ? (JSON.parse(plaintext) as RotatedRefreshToken) : null;
  }

  private encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [iv, ciphertext, tag]
      .map(part => part.toString('base64url'))
      .join('.');
  }

  // Returns null rather than throwing on anything malformed or
  // tamper-evident (GCM's auth tag check fails the same way corruption
  // would) — the caller treats that identically to a cache miss, which
  // is already the correct behavior for "nothing usable here yet".
  private decrypt(blob: string): string | null {
    try {
      const [ivB64, ciphertextB64, tagB64] = blob.split('.');

      if (!ivB64 || !ciphertextB64 || !tagB64) {
        throw new Error('malformed grace-cache entry');
      }

      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key,
        Buffer.from(ivB64, 'base64url'),
      );

      decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));

      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ciphertextB64, 'base64url')),
        decipher.final(),
      ]);

      return plaintext.toString('utf8');
    } catch (error) {
      console.error('[auth] refresh_grace_cache_decrypt_failed', error);

      return null;
    }
  }
}
