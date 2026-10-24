// sub is the user's uuid (see access-token.service.ts's own comment on the
// id-vs-uuid choice). role travels as a cache/UI-hint, never as the source
// of truth for an authorization decision — see auth.controller.ts's me()
// for why nothing here is trusted without a fresh DB read.
export interface AccessTokenClaims {
  sub: string;
  role: string;
  jti: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

export interface IssuedAccessToken {
  token: string;
  jti: string;
  exp: number;
}

export type VerifyResult =
  | { ok: true; claims: AccessTokenClaims }
  | { ok: false; reason: string };

export interface LoginResult extends IssuedAccessToken {
  expiresIn: number;
}
