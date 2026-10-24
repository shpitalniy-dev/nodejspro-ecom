import { Injectable, Scope } from '@nestjs/common';

// Caps how many of a given async operation run at once, process-wide —
// unlike a per-client rate limit (LoginRateLimitGuard), this bounds the
// actual resource (e.g. concurrent argon2id memory use) regardless of how
// many distinct clients the load comes from. A full queue rejects
// immediately instead of growing forever — an unbounded wait list is a
// second, slower way to run out of memory under sustained load.
export class ConcurrencyLimitExceededError extends Error {}

// Scope.TRANSIENT — every consumer that injects this gets its OWN instance
// (Nest constructs a fresh one per injection site), not a shared singleton.
// A consuming service calls configure() once, in its own constructor, so a
// queue backing up in one service can't affect, and isn't affected by, any
// other service's own limiter. Common/reusable infrastructure (alongside
// TokenBucketService et al.), not auth-specific — nothing in here is
// password/argon2-aware.
@Injectable({ scope: Scope.TRANSIENT })
export class ConcurrencyLimiter {
  private maxConcurrent = Infinity;
  private maxQueueDepth = Infinity;
  private inFlight = 0;
  private readonly waiting: Array<() => void> = [];

  configure(maxConcurrent: number, maxQueueDepth: number): void {
    this.maxConcurrent = maxConcurrent;
    this.maxQueueDepth = maxQueueDepth;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inFlight >= this.maxConcurrent) {
      if (this.waiting.length >= this.maxQueueDepth) {
        throw new ConcurrencyLimitExceededError(
          'too many operations already queued',
        );
      }

      await new Promise<void>(resolve => this.waiting.push(resolve));
    }

    this.inFlight++;

    try {
      return await fn();
    } catch (error) {
      console.error('[concurrency-limiter] operation failed', error);
      throw error;
    } finally {
      this.inFlight--;
      this.waiting.shift()?.();
    }
  }
}
