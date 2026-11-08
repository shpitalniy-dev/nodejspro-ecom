import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import type { Server } from 'node:http';

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
  private httpServer: Server | null = null;

  markReady(): void {
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  setHttpServer(server: Server): void {
    this.httpServer = server;
  }

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    this.ready = false;

    // A client holding a keep-alive connection to THIS pod from before
    // SIGTERM has no way to know it's draining — readiness only stops
    // the Service from handing out this pod's IP to NEW connections.
    // Without this, that client's next request reuses the old socket
    // and gets a connection reset the instant dispose() finally closes
    // it below, even though the deployment itself never actually went
    // unavailable. closeIdleConnections() evicts only idle keep-alive
    // sockets right now — a request already in flight keeps running —
    // so the client reconnects and lands on a pod that's actually
    // still accepting.
    this.httpServer?.closeIdleConnections();

    const drainMs = Number(process.env.DRAIN_MS ?? 5000);

    Logger.log(
      `[${signal}] ready=false, draining ${drainMs}ms`,
      ReadinessService.name,
    );

    await sleep(drainMs);
  }
}
