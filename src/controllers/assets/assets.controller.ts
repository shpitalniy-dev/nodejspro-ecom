import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';

import { AssetsService } from './assets.service.ts';

// No AuthGuard — this simulates what a CDN serves to the public internet,
// so it's meant to be reachable without a token. Raw bytes with a
// per-asset content-type, not a JSON resource, so this returns through
// @Res() rather than Nest's normal response handling — same reasoning
// OrdersController's SSE endpoint already uses @Res() for, and same
// reason this path is excluded from OpenAPI response validation
// (configure-app.ts's ignorePaths: validateResponses:true has nothing
// sensible to check a varying binary body against).
@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Get(':key')
  async get(@Param('key') key: string, @Res() res: Response): Promise<void> {
    const asset = await this.assetsService.get(key);

    if (!asset) {
      res.status(404).json({
        type: '/problems/404',
        title: 'Asset not found',
        status: 404,
        detail: `Asset "${key}" not found.`,
      });

      return;
    }

    res
      .status(200)
      .set({
        'content-type': asset.contentType,
        ...(asset.cacheControl ? { 'cache-control': asset.cacheControl } : {}),
        'x-cache': asset.cacheHit ? 'HIT' : 'MISS',
      })
      .send(asset.body);
  }
}
