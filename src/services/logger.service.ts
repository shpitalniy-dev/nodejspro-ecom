import { Injectable } from '@nestjs/common';

@Injectable()
export class LoggerService {
  logError(...args: unknown[]) {
    console.error(...args);
  }

  async logErrorOrIgnore<T>(fn: () => Promise<T>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.logError(e);
    }
  }
}
