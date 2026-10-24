import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

import { createRateLimitGuard } from '../../services/rate-limit/rate-limit.service.ts';

import { AccessDenylistService } from './access-denylist.service.ts';
import { AccessTokenService } from './access-token.service.ts';

const BEARER_PREFIX = 'Bearer ';

declare module 'express' {
  interface Request {
    user?: import('./auth.types.ts').AccessTokenClaims;
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly accessTokenService: AccessTokenService,
    private readonly accessDenylistService: AccessDenylistService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;

    if (!header?.startsWith(BEARER_PREFIX)) {
      throw this.unauthorized('Missing bearer token.');
    }

    const token = header.slice(BEARER_PREFIX.length);
    const result = this.accessTokenService.verify(token);

    if (!result.ok) {
      throw this.unauthorized('Access token is invalid or expired.');
    }

    // A denylisted token must be indistinguishable from an invalid one —
    // same rejection either way, nothing in the response reveals which
    // case this was.
    const denied = await this.accessDenylistService.isDenied(
      result.claims.iss,
      result.claims.jti,
    );

    if (denied) {
      throw this.unauthorized('Access token is invalid or expired.');
    }

    req.user = result.claims;

    return true;
  }

  private unauthorized(detail: string): UnauthorizedException {
    return new UnauthorizedException({ title: 'Unauthorized', detail });
  }
}

// Tight on purpose, same factory ProductsListRateLimitGuard already uses —
// no new rate-limit machinery. This is the per-client half of guarding
// against the concurrent-argon2id-memory risk (see PasswordService's own
// comment for the global half, ConcurrencyLimiter): bounding how many
// password verifications one client can have in flight is also just
// standard brute-force protection on a login endpoint, not overhead
// specific to this concern.
export const LoginRateLimitGuard = createRateLimitGuard({
  capacity: 5,
  refillPerSecond: 1,
  keyPrefix: 'auth:login',
});
