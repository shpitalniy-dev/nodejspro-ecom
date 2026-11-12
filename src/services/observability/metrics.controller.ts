import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';

import { registry } from './metrics.ts';

// @Res() bypasses Nest's own response handling — same reasoning as
// OrdersController's SSE endpoint: the body here is Prometheus's own text
// exposition format, not JSON, and registry.contentType is the one real
// source for the matching Content-Type.
@Controller()
export class MetricsController {
  @Get('metrics')
  async metrics(@Res() res: Response): Promise<void> {
    res.set('content-type', registry.contentType);
    res.send(await registry.metrics());
  }
}
