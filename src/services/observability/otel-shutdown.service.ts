import { Injectable, type OnApplicationShutdown } from '@nestjs/common';

import { sdk } from './otel.ts';

// onApplicationShutdown runs in Nest's final shutdown phase — after the
// HTTP server has already stopped accepting connections and
// ReadinessService's own drain has finished (see its own comment on the
// exact ordering) — so this flushes whatever spans were created up to and
// including the drain, instead of losing them to a SIGTERM that kills the
// process before a background OTLP export ever got a chance to happen.
@Injectable()
export class OtelShutdownService implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await sdk.shutdown();
  }
}
