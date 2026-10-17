import type { Logger } from 'typeorm';

// Counts real DB round-trips at the TypeORM Logger level — the only honest
// way to measure "did a query actually run", as opposed to counting how
// many times a wrapper function was called (which says nothing about what
// it did underneath). Shared by demo-nplus1.ts and services/cache/demo
// /demo-cache.ts, both of which build their own DataSource wired to one of
// these instead of using the app's shared connection.
export class QueryCountLogger implements Logger {
  count = 0;

  logQuery(): void {
    this.count++;
  }

  logQueryError(): void {}
  logQuerySlow(): void {}
  logSchemaBuild(): void {}
  logMigration(): void {}
  log(): void {}
}
