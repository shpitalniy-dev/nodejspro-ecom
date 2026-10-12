import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Injectable } from '@nestjs/common';

import { DataSourceService } from '../../services/data-source.service.ts';
import { sleep } from '../../utils/sleep.ts';

import { DEFAULT_BATCH_SIZE, RelayService } from './relay.service.ts';

const POLL_INTERVAL_MS = 200;

@Injectable()
export class RelayWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private stopped = false;
  private loopPromise: Promise<void> | null = null;

  constructor(
    private readonly dataSourceService: DataSourceService,
    private readonly relay: RelayService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.loopPromise = this.loop();
    console.log('[relay-worker] polling outbox');
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      try {
        const manager = await this.dataSourceService.getManager();
        const published = await this.relay.relayBatch(
          manager,
          DEFAULT_BATCH_SIZE,
        );

        if (published === 0) {
          await sleep(POLL_INTERVAL_MS);
        }
      } catch (error) {
        console.error('[relay-worker] batch failed', error);
        await sleep(POLL_INTERVAL_MS);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    await this.loopPromise?.catch(() => undefined);
  }
}
