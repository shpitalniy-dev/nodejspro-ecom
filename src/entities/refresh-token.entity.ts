import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';

import { User } from './user.entity.ts';

// HW #24, slice 2 — refresh-token rotation with reuse detection. `id` is
// the internal working key (claim UPDATE, grace-cache key) — never sent to
// a client; `uuid` is this row's own stable identity, same id+uuid split
// every other table here uses (users/orders), not a lecture-specific
// pattern. `family_id` is independent of `user_id` — a fresh UUID per
// login, not derived from the user — so one compromised session's reuse
// detection revokes only that chain, not every device the user is
// logged into.
@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('identity', {
    name: 'id',
    type: 'int',
    generatedIdentity: 'ALWAYS',
  })
  id!: number;

  @Index('refresh_tokens_uuid_key', ['uuid'], { unique: true })
  @Column({ name: 'uuid', type: 'uuid', default: () => 'gen_random_uuid()' })
  uuid!: string;

  @Index('refresh_tokens_family_id_idx')
  @Column({ name: 'family_id', type: 'uuid' })
  familyId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<User>;

  // sha256(pepper‖token) via HMAC, never the token itself — see
  // refresh-token.service.ts's hashToken().
  @Index('refresh_tokens_token_hash_key', ['tokenHash'], { unique: true })
  @Column({ name: 'token_hash', type: 'text' })
  tokenHash!: string;

  // Set once, atomically, by the UPDATE ... WHERE used_at IS NULL claim in
  // rotate() — null means "still the live end of the chain."
  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt!: Date | null;

  // Set on logout or on reuse detection — the whole family at once, not
  // one row at a time.
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  // Idle TTL — extended on every successful rotation.
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  // Hard ceiling, copied forward unchanged on every rotation — never
  // extended, so an endlessly-active chain still can't outlive it.
  @Column({ name: 'absolute_expires_at', type: 'timestamptz' })
  absoluteExpiresAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
