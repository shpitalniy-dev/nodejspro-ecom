import { Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

export interface TokenBucketConsumeOptions {
  capacity: number;
  refillPerSecond: number;
  cost?: number; // default 1
}

export interface TokenBucketResult {
  allowed: boolean;
  remainingTokens: number;
  retryAfterSeconds: number; // 0 when allowed; otherwise >= 1
}

// Token bucket rate limiter (HW #23 point 4) — deliberately allows a burst
// up to `capacity`, then refills at `refillPerSecond`, the same choice
// Stripe/AWS API Gateway make for their own limiters. Lua script ported
// directly from the course's own lecture material (06-rate-limit.ts /
// lib/redis.ts's TOKEN_BUCKET_LUA), atomic because Redis is single-threaded
// — a plain HMGET-then-HSET round trip from JS would let two concurrent
// callers both read the same stale token count and both believe they're
// allowed.
const TOKEN_BUCKET_LUA = `
local now      = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local rate     = tonumber(ARGV[3])
local cost     = tonumber(ARGV[4])

local st     = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(st[1])
local ts     = tonumber(st[2])
if tokens == nil then tokens = capacity; ts = now end

tokens = math.min(capacity, tokens + (now - ts) * rate / 1000)

local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call('HSET',    KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / rate * 1000) + 1000)
return {allowed, math.floor(tokens * 1000)}
`;

@Injectable()
export class TokenBucketService {
  constructor(private readonly redis: Redis) {}

  async consume(
    key: string,
    opts: TokenBucketConsumeOptions,
  ): Promise<TokenBucketResult> {
    const cost = opts.cost ?? 1;
    // tokensLeft comes back scaled by 1000 to preserve fractional precision
    // as an integer over RESP (Lua/Redis have no native float return type
    // here) — same convention the lecture's own script uses.
    const [allowedRaw, tokensScaled] = (await this.redis.eval(
      TOKEN_BUCKET_LUA,
      1,
      key,
      Date.now(),
      opts.capacity,
      opts.refillPerSecond,
      cost,
    )) as unknown as [number, number];

    const allowed = allowedRaw === 1;
    const remainingTokens = tokensScaled / 1000;

    return {
      allowed,
      remainingTokens,
      retryAfterSeconds: allowed
        ? 0
        : Math.max(
            1,
            Math.ceil((cost - remainingTokens) / opts.refillPerSecond),
          ),
    };
  }
}
