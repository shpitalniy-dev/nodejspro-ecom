import type { CanActivate, ExecutionContext } from '@nestjs/common';
import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { createRateLimitGuard } from '../../services/rate-limit/rate-limit.service.ts';

import { AccessDenylistService } from './access-denylist.service.ts';
import { AccessTokenService } from './access-token.service.ts';
import { ROLES_KEY } from './roles.decorator.ts';

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

// Trusts the JWT's own `role` claim rather than re-reading the DB — the
// opposite call from auth.controller.ts's me(), deliberately: that
// endpoint exists to give a client an accurate view of its OWN identity
// on demand, not to gate every request. Re-reading the DB here would
// erase the entire latency benefit of a stateless access token. Accepted
// tradeoff (see README): a demoted admin keeps admin rights until their
// access token's exp (10 minutes), not revoked early.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get<string[] | undefined>(
      ROLES_KEY,
      context.getHandler(),
    );

    if (!required || required.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const role = req.user?.role;

    if (!role || !required.includes(role)) {
      throw new ForbiddenException({
        title: 'Forbidden',
        detail: `Requires one of the following roles: ${required.join(', ')}.`,
      });
    }

    return true;
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
