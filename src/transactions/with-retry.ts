import { DatabaseError } from 'pg';
import type { DataSource, EntityManager } from 'typeorm';
import { QueryFailedError } from 'typeorm';

// Postgres's own instruction to "try the whole transaction again", nothing
// else: 40001 (serialization_failure) means a REPEATABLE READ/SERIALIZABLE
// snapshot went stale against a concurrent commit; 40P01 (deadlock_detected)
// means Postgres broke a lock cycle by picking this transaction as the
// victim. Every other error is a real bug or a real business-rule
// violation (e.g. a CHECK constraint) — retrying those would just fail
// identically forever, or worse, mask the actual problem.
const RETRYABLE_CODES = new Set(['40001', '40P01']);

// QueryFailedError.driverError is the raw pg error (a DatabaseError, which
// genuinely has a `.code`) — verified directly against TypeORM's own
// source (PostgresQueryRunner wraps every failed query in
// `new QueryFailedError(query, parameters, err)`) rather than assumed.
function getPgErrorCode(err: unknown): string | undefined {
  return err instanceof QueryFailedError &&
    err.driverError instanceof DatabaseError
    ? err.driverError.code
    : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface RetryOutcome<T> {
  result: T;
  retries: number;
}

// Retries the ENTIRE transaction from the top — including every read —
// never just the write. Retrying only the write on a stale read is the
// exact lost-update bug this pattern exists to prevent.
export async function withRetry<T>(
  dataSource: DataSource,
  isolation: 'REPEATABLE READ' | 'SERIALIZABLE',
  fn: (manager: EntityManager) => Promise<T>,
  maxAttempts = 5,
): Promise<RetryOutcome<T>> {
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await dataSource.transaction(isolation, fn);

      return { result, retries: attempt - 1 };
    } catch (err) {
      const code = getPgErrorCode(err);
      const retryable = code !== undefined && RETRYABLE_CODES.has(code);

      if (!retryable || attempt >= maxAttempts) {
        throw err;
      }

      const backoffMs = Math.round(2 ** attempt * 25 + Math.random() * 25);
      console.log(
        `  retry ${attempt}: caught ${code}, backing off ${backoffMs}ms`,
      );
      await sleep(backoffMs);
    }
  }
}
