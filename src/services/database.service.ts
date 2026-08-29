import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

import { Env } from '../config/env.schema.ts';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(config: ConfigService<Env, true>) {
    const passwordFile = config.get('DB_PASSWORD_FILE', { infer: true });

    this.pool = new Pool({
      host: config.get('DB_HOST', { infer: true }),
      port: config.get('DB_PORT', { infer: true }),
      database: config.get('DB_NAME', { infer: true }),
      user: config.get('DB_USER', { infer: true }),
      password: async () => (await readFile(passwordFile, 'utf8')).trim(),
      max: 3,
    });

    this.pool.on('error', () => {
      // Server closed an idle connection (rotation, failover, pg_terminate_backend).
      // The pool opens a fresh one on the next query — this must stay handled,
      // or Node crashes with an unhandled 'error' event.
    });
  }

  ping() {
    return this.pool.query<{ current_user: string; now: string }>(
      'SELECT current_user, now()::text AS now',
    );
  }

  onModuleDestroy() {
    return this.pool.end();
  }
}
