import { Controller, Get } from '@nestjs/common';

import { DatabaseService } from '../../services/database.service.ts';

@Controller()
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Get('health')
  health() {
    return { status: 'ok', uptime: process.uptime() };
  }

  @Get('health/db')
  async healthDb() {
    const { rows } = await this.db.ping();

    return { status: 'ok', uptime: process.uptime(), db: rows[0] };
  }
}
