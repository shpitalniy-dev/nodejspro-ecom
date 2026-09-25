import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';

import { Env } from '../config/env.schema.ts';
import { entities } from '../entities/index.ts';

@Injectable()
export class DataSourceService implements OnModuleDestroy {
  readonly dataSource: DataSource;

  private initPromise: Promise<DataSource> | null = null;

  constructor(config: ConfigService<Env, true>) {
    const passwordFile = config.get('DB_PASSWORD_FILE', { infer: true });

    // Same connection info as DatabaseService (DB_HOST/PORT/NAME/USER +
    // rotating password file) — TypeORM's `password` accepts an async
    // function exactly like pg.Pool's does, so this survives a rotation the
    // same way DatabaseService's own pool already does.
    this.dataSource = new DataSource({
      type: 'postgres',
      host: config.get('DB_HOST', { infer: true }),
      port: config.get('DB_PORT', { infer: true }),
      database: config.get('DB_NAME', { infer: true }),
      username: config.get('DB_USER', { infer: true }),
      password: async () => (await readFile(passwordFile, 'utf8')).trim(),
      entities,
      synchronize: false,
      migrationsRun: false,
    });
  }

  // Lazy — like DatabaseService's pg.Pool, which only opens a connection on
  // first query. `api`'s container has no db_password secret mounted (a
  // deliberate HW #13 decision) and no healthcheck, so `docker compose up
  // -d --wait` only waits for the container to be running, not for this to
  // succeed. Initializing eagerly from a lifecycle hook would make the
  // missing secret crash the whole app at boot instead of failing only the
  // requests that actually touch the DB — the same accepted failure mode
  // `/health/db` already has.
  getManager(): Promise<EntityManager> {
    this.initPromise ??= this.dataSource.initialize();

    return this.initPromise.then(dataSource => dataSource.manager);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.dataSource.isInitialized) {
      await this.dataSource.destroy();
    }
  }
}
