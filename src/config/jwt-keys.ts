import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';

import type { Env } from './env.schema.ts';

export interface JwtKeys {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
}

// Decoded once at construction, not on every sign/verify call — a
// malformed key then fails at startup (constructor runs during Nest's
// provider instantiation) rather than on the first login request.
@Injectable()
export class JwtKeysService implements JwtKeys {
  readonly kid: string;
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;

  constructor(config: ConfigService<Env, true>) {
    this.kid = config.get('JWT_KID', { infer: true });
    this.privateKey = createPrivateKey(
      Buffer.from(config.get('JWT_PRIVATE_KEY', { infer: true }), 'base64'),
    );
    this.publicKey = createPublicKey(
      Buffer.from(config.get('JWT_PUBLIC_KEY', { infer: true }), 'base64'),
    );
  }
}
