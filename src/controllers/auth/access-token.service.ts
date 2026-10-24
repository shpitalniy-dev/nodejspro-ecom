import { Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';

import { JwtKeysService } from '../../config/jwt-keys.ts';

import type { IssuedAccessToken, VerifyResult } from './auth.types.ts';

export const ISSUER = 'nodejspro-ecom';
export const AUDIENCE = 'nodejspro-ecom-api';
const ACCESS_TOKEN_TTL_SECONDS = 600; // 10 min

// Allowlist, not read from the token's own header — this is the actual
// security-bearing line (RFC 8725 §3.1); a verifier must never let the
// token decide which algorithm proves it.
const ALLOWED_ALGORITHMS: jwt.Algorithm[] = ['ES256'];

@Injectable()
export class AccessTokenService {
  constructor(private readonly keys: JwtKeysService) {}

  issue(user: { uuid: string; role: string }): IssuedAccessToken {
    const jti = randomUUID();
    const token = jwt.sign({ role: user.role }, this.keys.privateKey, {
      algorithm: 'ES256',
      subject: user.uuid,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      jwtid: jti,
      keyid: this.keys.kid,
    });

    const decoded = jwt.decode(token) as { exp: number };

    return { token, jti, exp: decoded.exp };
  }

  verify(token: string): VerifyResult {
    const header = this.safeDecodeHeader(token);

    if (header?.kid !== undefined && header.kid !== this.keys.kid) {
      return { ok: false, reason: `unknown kid "${header.kid}"` };
    }

    try {
      const claims = jwt.verify(token, this.keys.publicKey, {
        algorithms: ALLOWED_ALGORITHMS,
        issuer: ISSUER,
        audience: AUDIENCE,
      }) as unknown as jwt.JwtPayload;

      if (!claims.jti) {
        return { ok: false, reason: 'missing jti claim' };
      }

      return {
        ok: true,
        claims: {
          sub: claims.sub ?? '',
          role: typeof claims.role === 'string' ? claims.role : '',
          jti: claims.jti,
          iss: claims.iss ?? '',
          aud: typeof claims.aud === 'string' ? claims.aud : '',
          iat: claims.iat ?? 0,
          exp: claims.exp ?? 0,
        },
      };
    } catch (error) {
      return { ok: false, reason: (error as Error).message };
    }
  }

  private safeDecodeHeader(token: string): { kid?: string } | null {
    const part = token.split('.')[0];

    if (!part) {
      return null;
    }

    try {
      return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as {
        kid?: string;
      };
    } catch {
      return null;
    }
  }
}
