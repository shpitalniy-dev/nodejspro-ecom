// Postgres SQLSTATE codes, used through the predicates below.
const FOREIGN_KEY_VIOLATION = '23503';

// TypeORM wraps the driver error, so the SQLSTATE sits on driverError. A
// thrown value can be anything (including undefined), hence the optional chain.
function hasPgCode(error: unknown, code: string): boolean {
  const driverError = (error as { driverError?: { code?: string } } | undefined)
    ?.driverError;

  return driverError?.code === code;
}

// A row points at a parent that does not exist (e.g. an order that was never
// created). Retrying cannot fix that.
export function isForeignKeyViolation(error: unknown): boolean {
  return hasPgCode(error, FOREIGN_KEY_VIOLATION);
}
