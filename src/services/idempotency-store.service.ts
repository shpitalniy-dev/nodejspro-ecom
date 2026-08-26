import { Injectable } from '@nestjs/common';

const TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface IdempotencyRecord {
  state: 'in-flight' | 'done';
  fingerprint: string;
  body?: unknown;
  expiresAt: number;
}

interface ClaimResult {
  created: boolean;
  record: IdempotencyRecord;
}

@Injectable()
export class IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  claim(key: string, fingerprint: string): ClaimResult {
    const existing = this.records.get(key);

    if (existing && existing.expiresAt > Date.now()) {
      return { created: false, record: existing };
    }

    const record: IdempotencyRecord = {
      state: 'in-flight',
      fingerprint,
      expiresAt: Date.now() + TTL_MS,
    };

    this.records.set(key, record);

    return { created: true, record };
  }

  finish(key: string, body: unknown): void {
    const record = this.records.get(key);

    if (record) {
      record.state = 'done';
      record.body = body;
    }
  }
}
