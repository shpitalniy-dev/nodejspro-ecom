import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { DatabaseService } from '../../services/database.service.ts';
import { ReadinessService } from '../../services/readiness.service.ts';

@Controller()
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly readiness: ReadinessService,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok', uptime: process.uptime() };
  }

  @Get('health/db')
  async healthDb() {
    const { rows } = await this.db.ping();

    return { status: 'ok', uptime: process.uptime(), db: rows[0] };
  }

  // HW #28 — liveness: "is the process alive," never touches a
  // downstream dependency. Coupling liveness to DB/broker/cache health is
  // the named K8s anti-pattern: one shared dependency blip would restart
  // every pod of every service depending on it, worsening an incident
  // instead of fixing it.
  @Get('healthz')
  healthz() {
    return { status: 'ok', uptime: process.uptime() };
  }

  // HW #28 — readiness: "can I usefully take traffic right now." Failing
  // this only pulls the pod out of load-balancing rotation (no restart,
  // no cascade), which is why it's safe for this to be the one that
  // flips on SIGTERM (see ReadinessService) — unlike /healthz above.
  @Get('readyz')
  readyz() {
    if (!this.readiness.isReady()) {
      throw new ServiceUnavailableException({ ready: false });
    }

    return { ready: true };
  }
}
