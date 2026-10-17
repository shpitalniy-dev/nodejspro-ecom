import type { CanActivate, ExecutionContext, Type } from '@nestjs/common';
import { HttpException, HttpStatus, Injectable, mixin } from '@nestjs/common';
import type { Request, Response } from 'express';

import { TokenBucketService } from './token-bucket.service.ts';

export interface RateLimitGuardOptions {
  capacity: number;
  refillPerSecond: number;
  // Identifies this limit, both in the Redis key (so two guards never
  // share a bucket) and in the error response.
  keyPrefix: string;
}

// Factory for a per-client (IP) rate-limit guard, reusable across any
// endpoint: each call produces its own guard class with its own capacity/
// refill/key, all backed by the same shared TokenBucketService — this is
// what lets a second endpoint get its own independent limit later without
// a second hand-written guard class. No reverse proxy sits in front of
// `api` in this compose stack, so req.ip already reflects the real client
// — no trust-proxy configuration needed.
export function createRateLimitGuard(
  options: RateLimitGuardOptions,
): Type<CanActivate> {
  @Injectable()
  class RateLimitGuard implements CanActivate {
    constructor(private readonly tokenBucket: TokenBucketService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
      const req = context.switchToHttp().getRequest<Request>();
      const res = context.switchToHttp().getResponse<Response>();

      const result = await this.tokenBucket.consume(
        `ratelimit:${options.keyPrefix}:${req.ip}`,
        {
          capacity: options.capacity,
          refillPerSecond: options.refillPerSecond,
        },
      );

      if (!result.allowed) {
        // Set before throwing — ProblemExceptionFilter only calls
        // res.status()/.type()/.json(), it never clears headers set
        // earlier on the same Response, same pattern
        // IdempotencyKeyInterceptor already uses for its own
        // Idempotency-Replay header.
        res.setHeader('Retry-After', String(result.retryAfterSeconds));

        throw new HttpException(
          {
            title: 'Too many requests',
            detail: `Rate limit exceeded for ${options.keyPrefix}.`,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      return true;
    }
  }

  return mixin(RateLimitGuard);
}
