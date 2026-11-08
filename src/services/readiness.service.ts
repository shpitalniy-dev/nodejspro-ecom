import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';

import { sleep } from '../utils/sleep.ts';

// SIGTERM handling has to live in beforeApplicationShutdown, not a
// hand-rolled process.on('SIGTERM', ...): Nest's own shutdown sequence
// (callDestroyHook -> callBeforeShutdownHook -> dispose() [closes the
// HTTP server] -> callShutdownHook) only lets this hook run BEFORE the
// socket actually closes. onModuleDestroy (e.g. DatabaseService's pool)
// runs first, before this — harmless here since nothing's really
// connected (see infra/index.ts), but a real gotcha for a deployment
// where those connections are live.
@Injectable()
export class ReadinessService implements BeforeApplicationShutdown {
  private ready = false;

  markReady(): void {
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    this.ready = false;

    const drainMs = Number(process.env.DRAIN_MS ?? 5000);

    Logger.log(
      `[${signal}] ready=false, draining ${drainMs}ms`,
      ReadinessService.name,
    );

    await sleep(drainMs);
  }
}
