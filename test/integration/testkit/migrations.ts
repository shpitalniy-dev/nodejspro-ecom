import { InitialSchema1789069491002 } from '../../../src/migrations/1789069491002-InitialSchema.ts';
import { AddBalanceAndTasks1789156780786 } from '../../../src/migrations/1789156780786-AddBalanceAndTasks.ts';
import { AddOrderItemsIndexes1789231614310 } from '../../../src/migrations/1789231614310-AddOrderItemsIndexes.ts';

// Chronological list of migration classes, in run order — used by the
// integration/E2E test DataSource (postgres-container.ts) instead of the
// glob string data-source.ts uses for the production build. TypeORM
// resolves a migration glob via a dynamic `import()` at runtime, which
// under Jest's `--experimental-vm-modules` gets cached by Node's real ESM
// loader across test files rather than per-file the way `require()` is —
// passing the actual classes sidesteps that codepath entirely.
//
// Deliberately lives under test/, not src/migrations/ — that directory is
// itself globbed by data-source.ts's `migrations: ['build/migrations/*.js']`
// for the production build; a barrel file re-importing the same classes
// there made TypeORM see every migration twice ("Duplicate migrations").
export const migrations = [
  InitialSchema1789069491002,
  AddBalanceAndTasks1789156780786,
  AddOrderItemsIndexes1789231614310,
];
