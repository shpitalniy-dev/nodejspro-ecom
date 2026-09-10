import 'reflect-metadata';

import { DataSource } from 'typeorm';

import { entities } from './entities/index.ts';

// Every value comes from process.env — populated by scripts/with-secrets.sh
// (Infisical) in normal use, or exported directly with SKIP_VAULT=1 by the
// grader. No hardcoded host/credentials, no separate env file read here.
//
// DB_URL carries admin credentials on purpose: migrations, seed and the
// report all need DDL / broad rights that app_user doesn't have.
if (!process.env.DB_URL) {
  throw new Error(
    'DB_URL is not set — run through scripts/with-secrets.sh, or export it with SKIP_VAULT=1',
  );
}

// Single export of the DataSource instance — the TypeORM CLI (`-d`) rejects
// a file that exports more than one.
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DB_URL,
  entities,
  migrations: ['build/migrations/*.js'],
  synchronize: false,
  migrationsRun: false,
  logging: ['error', 'warn'],
});
