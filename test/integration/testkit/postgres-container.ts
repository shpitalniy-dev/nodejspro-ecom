import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';

import { entities } from '../../../src/entities/index.ts';

import { migrations } from './migrations.ts';

export interface TestPg {
  dataSource: DataSource;
  container: StartedPostgreSqlContainer;
  stop(): Promise<void>;
}

// One real Postgres per test file (postgres:17-alpine — the same image
// docker-compose.yml runs, not the lecture's unrelated 16-alpine default),
// migrated with the project's REAL migrations, never `synchronize`. Those
// migrations hand-add things entity decorators can't express (the
// lower(email) unique index, the set_updated_at() trigger) — a synchronized
// schema would silently be missing both, and tests would pass against a
// database no environment actually runs.
//
// Builds its own DataSource rather than importing src/data-source.ts's
// AppDataSource — that module throws at import time unless DB_URL is
// already set, which it never is here (the container's URL isn't known
// until after it starts).
export async function startTestPostgres(): Promise<TestPg> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();

  const dataSource = new DataSource({
    type: 'postgres',
    url: container.getConnectionUri(),
    entities,
    migrations,
    synchronize: false,
    migrationsRun: false,
  });

  await dataSource.initialize();
  await dataSource.runMigrations();

  return {
    dataSource,
    container,
    async stop() {
      await dataSource.destroy();
      await container.stop();
    },
  };
}
