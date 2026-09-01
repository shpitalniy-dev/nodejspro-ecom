import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';

import { DatabaseService } from '../../services/database.service.ts';

@Controller()
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok', uptime: process.uptime() };
  }

  @Get('health/db')
  async healthDb() {
    const { rows } = await this.db.ping();
    const demoSecretFile = this.config.get('INFISICAL_DEMO_SECRET_FILE');
    const demoSecret = (await readFile(demoSecretFile, 'utf8')).trim();

    return {
      status: 'ok',
      uptime: process.uptime(),
      db: rows[0],
      env: { demoSecret },
    };
  }
}
