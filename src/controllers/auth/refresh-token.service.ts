import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';

import type { Env } from '../../config/env.schema.ts';
import { RefreshToken } from '../../entities/refresh-token.entity.ts';
import { DataSourceService } from '../../services/data-source.service.ts';
import { sleep } from '../../utils/sleep.ts';

import type {
  IssuedRefreshToken,
  RotatedRefreshToken,
  RotateResult,
} from './auth.types.ts';
import { RefreshGraceCacheService } from './refresh-grace-cache.service.ts';

export const IDLE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days — reset on every rotation
const ABSOLUTE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days — never extended

export const GRACE_WINDOW_MS = 3000;
const GRACE_WINDOW_SECONDS = GRACE_WINDOW_MS / 1000;
const GRACE_POLL_INTERVAL_MS = 10;
const GRACE_POLL_MAX_WAIT_MS = Math.min(GRACE_WINDOW_MS, 500);

@Injectable()
export class RefreshTokenService {
  private readonly pepper: string;

  constructor(
    private readonly dataSourceService: DataSourceService,
    private readonly graceCache: RefreshGraceCacheService,
    config: ConfigService<Env, true>,
  ) {
    this.pepper = config.get('REFRESH_TOKEN_PEPPER', { infer: true });
  }

  // HMAC, not sha256(pepper + token) — a plain concatenation is
  // length-extension-vulnerable on SHA-256; HMAC's two-pass construction
  // is what actually closes that.
  private hashToken(token: string): string {
    return createHmac('sha256', this.pepper).update(token).digest('hex');
  }

  async issueFamily(userId: number): Promise<IssuedRefreshToken> {
    // 256 bits, same entropy reasoning as the lecture's own refresh
    // tokens — a bearer secret, not just an identifier, so randomUUID()
    // (122 bits, several fixed version/variant bits) isn't the right
    // primitive here the way it is for family_id.
    const token = randomBytes(32).toString('base64url');
    const manager = await this.dataSourceService.getManager();

    // now() + interval, computed by Postgres, not `new Date(Date.now() + …)`
    await manager.getRepository(RefreshToken).insert({
      familyId: randomUUID(),
      user: { id: userId },
      tokenHash: this.hashToken(token),
      expiresAt: () => `now() + interval '${IDLE_TTL_SECONDS} seconds'`,
      absoluteExpiresAt: () =>
        `now() + interval '${ABSOLUTE_TTL_SECONDS} seconds'`,
    });

    return { token };
  }

  async rotate(token: string): Promise<RotateResult> {
    const hash = this.hashToken(token);
    const manager = await this.dataSourceService.getManager();
    const row = await manager.getRepository(RefreshToken).findOne({
      where: { tokenHash: hash },
      relations: { user: true },
    });

    if (!row) {
      return { status: 'unknown' };
    }

    if (row.revokedAt) {
      return { status: 'revoked' };
    }

    const now = Date.now();

    if (now > row.absoluteExpiresAt.getTime()) {
      return { status: 'expired', kind: 'absolute' };
    }

    if (now > row.expiresAt.getTime()) {
      return { status: 'expired', kind: 'idle' };
    }

    let usedAt = row.usedAt;

    if (usedAt === null) {
      // Claim and mint the successor in one transaction — if the insert
      // fails, the claim rolls back too, so the client can retry with the
      // same still-valid token instead of it being permanently bricked by
      // a transient DB error.
      const minted = await manager.transaction(async tx => {
        const claimed = await this.claim(tx, row.id);

        return claimed ? this.mintSuccessor(tx, row) : null;
      });

      if (minted) {
        return minted;
      }

      // Lost the race to a concurrent request — re-read to get the
      // winner's timestamp; `row.usedAt` is stale (was null when we first
      // read it, a moment before the winner's claim landed).
      usedAt = await this.readUsedAt(manager, row.id);
    }

    // Already used, either originally or because we just lost the race
    // above.
    const graceMs = Date.now() - usedAt.getTime();

    if (graceMs <= GRACE_WINDOW_MS) {
      const cached = await this.pollGraceCache(row.id);

      if (cached) {
        return { status: 'ok', result: cached };
      }
    }

    // Outside the grace window — this is reuse, not a client-side race.
    // Revoke the whole family, including whatever the legitimate rotation
    // issued one step ahead: that's what makes a replayed R1 also kill
    // R2, not just itself.
    await this.revokeFamily(row.familyId, manager);
    console.error(
      `[auth] refresh_reuse_detected family=${row.familyId} user_id=${row.user.id}`,
    );

    return { status: 'reuse' };
  }

  async revokeFamily(familyId: string, manager?: EntityManager): Promise<void> {
    const m = manager ?? (await this.dataSourceService.getManager());

    await m.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`,
      [familyId],
    );
  }

  // Logout's half of "revoke family and denylist jti" — looks up which
  // family this cookie belongs to and revokes it, without rotating
  // (logging out isn't "using" the token the way a real refresh is, and
  // treating it as a claim would tangle this up with reuse detection).
  // Best-effort: an unknown or already-revoked token is a silent no-op,
  // same spirit as AccessDenylistService's own write path — logout should
  // still succeed even if the cookie is stale.
  async revokeFamilyForToken(token: string): Promise<void> {
    const hash = this.hashToken(token);
    const manager = await this.dataSourceService.getManager();
    const row = await manager
      .getRepository(RefreshToken)
      .findOne({ where: { tokenHash: hash } });

    if (row) {
      await this.revokeFamily(row.familyId, manager);
    }
  }

  // Row-level atomicity, not an explicit lock — exactly one concurrent
  // caller gets a row back from RETURNING, regardless of isolation level,
  // because Postgres re-checks this WHERE clause after a blocking
  // concurrent UPDATE on the same row commits.
  private async claim(manager: EntityManager, rowId: number): Promise<boolean> {
    const result: unknown[] = await manager.query(
      `UPDATE refresh_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id`,
      [rowId],
    );

    return result.length > 0;
  }

  private async readUsedAt(
    manager: EntityManager,
    rowId: number,
  ): Promise<Date> {
    const result = (await manager.query(
      `SELECT used_at FROM refresh_tokens WHERE id = $1`,
      [rowId],
    )) as Array<{ used_at: Date }>;
    const row = result[0];

    if (!row) {
      throw new Error(`refresh_tokens row ${rowId} vanished mid-rotation`);
    }

    return row.used_at;
  }

  private async mintSuccessor(
    manager: EntityManager,
    oldRow: RefreshToken,
  ): Promise<{ status: 'ok'; result: RotatedRefreshToken }> {
    const token = randomBytes(32).toString('base64url');

    await manager.getRepository(RefreshToken).insert({
      familyId: oldRow.familyId,
      user: { id: oldRow.user.id },
      tokenHash: this.hashToken(token),
      // Postgres's own now(), same reasoning as issueFamily()
      expiresAt: () => `now() + interval '${IDLE_TTL_SECONDS} seconds'`,
      absoluteExpiresAt: oldRow.absoluteExpiresAt,
    });

    const result: RotatedRefreshToken = {
      refreshToken: token,
      userId: oldRow.user.id,
    };

    await this.graceCache.set(oldRow.id, result, GRACE_WINDOW_SECONDS);

    return { status: 'ok', result };
  }

  private async pollGraceCache(
    oldRowId: number,
  ): Promise<RotatedRefreshToken | null> {
    const deadline = Date.now() + GRACE_POLL_MAX_WAIT_MS;

    for (;;) {
      const cached = await this.graceCache.get(oldRowId);

      if (cached) {
        return cached;
      }

      if (Date.now() > deadline) {
        return null;
      }

      await sleep(GRACE_POLL_INTERVAL_MS);
    }
  }
}
