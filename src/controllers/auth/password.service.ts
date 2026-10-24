import { Injectable } from '@nestjs/common';
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';

import { ConcurrencyLimiter } from '../../services/concurrency-limiter.ts';

// Each hash operation transiently allocates `memoryCost` KiB — real memory,
// not a figure of speech. 24 concurrent * 19 MiB ≈ 456 MiB, comfortably
// under the `api` container's 1G limit (docker-compose.yml) with headroom
// left for Node/Express/the TypeORM pool; the 50-deep queue is the backstop
// for a burst beyond that, past which new callers get a clean rejection
// instead of adding to an ever-growing wait list.
const MAX_CONCURRENT_HASHES = 24;
const MAX_QUEUED_HASHES = 50;

// OWASP's recommended Argon2id tuple. Confirmed directly against the
// installed @node-rs/argon2@2.2.2's own index.d.ts: its built-in default is
// already memoryCost=19456/timeCost=2/parallelism=1 (identical to what's
// passed here) — so this isn't correcting a weak default, it's pinning the
// parameters explicitly so a future dependency bump can't silently change
// them out from under already-stored hashes without it showing up in a
// diff. No separate salt/pepper handling needed — argon2id's own PHC-format
// output already embeds a fresh salt per hash.
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class PasswordService {
  constructor(private readonly limiter: ConcurrencyLimiter) {
    this.limiter.configure(MAX_CONCURRENT_HASHES, MAX_QUEUED_HASHES);
  }

  hash(password: string): Promise<string> {
    return this.limiter.run(() => argon2Hash(password, ARGON2_OPTIONS));
  }

  // No options passed on verify — memoryCost/timeCost/parallelism/salt are
  // all encoded in the stored PHC string itself, which is what verify()
  // actually reads; passing ARGON2_OPTIONS again here would be inert.
  verify(storedHash: string, password: string): Promise<boolean> {
    return this.limiter.run(() => argon2Verify(storedHash, password));
  }
}
