import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common';
import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import type { Observable } from 'rxjs';
import { of, tap } from 'rxjs';

import { IdempotencyStore } from '../services/idempotency-store.service.ts';

@Injectable()
export class IdempotencyKeyInterceptor implements NestInterceptor {
  constructor(private readonly store: IdempotencyStore) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const key = req.headers['idempotency-key'] as string;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(req.body ?? null))
      .digest('hex');

    const { created, record } = this.store.claim(key, fingerprint);

    if (!created) {
      if (record.fingerprint !== fingerprint) {
        throw new UnprocessableEntityException({
          title: 'Idempotency key reused with a different body',
          detail: `Idempotency-Key "${key}" was already used with a different request body.`,
        });
      }

      if (record.state === 'in-flight') {
        throw new ConflictException({
          title: 'Request already in progress',
          detail: `A request with Idempotency-Key "${key}" is already being processed.`,
        });
      }

      res.setHeader('Idempotency-Replay', 'true');

      return of(record.body);
    }

    return next.handle().pipe(tap(body => this.store.finish(key, body)));
  }
}
