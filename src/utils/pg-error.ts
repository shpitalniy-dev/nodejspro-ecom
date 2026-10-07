import { DatabaseError } from 'pg';
import { QueryFailedError } from 'typeorm';

// Postgres SQLSTATE codes used by the app.
const FOREIGN_KEY_VIOLATION = '23503';

// The SQLSTATE of a failed query, or undefined for anything else. TypeORM
// wraps every failed query in a QueryFailedError, and its driverError is the
// raw pg DatabaseError, which carries the code. Both instanceof checks mean
// only real Postgres errors yield a code (verified against TypeORM's own
// source: PostgresQueryRunner wraps each failure this way).
export function getPgErrorCode(err: unknown): string | undefined {
  return err instanceof QueryFailedError &&
    err.driverError instanceof DatabaseError
    ? err.driverError.code
    : undefined;
}

// A row points at a parent that does not exist (e.g. an order that was never
// created). Retrying cannot fix that.
export function isForeignKeyViolation(err: unknown): boolean {
  return getPgErrorCode(err) === FOREIGN_KEY_VIOLATION;
}
