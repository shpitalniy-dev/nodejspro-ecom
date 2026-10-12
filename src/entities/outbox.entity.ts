import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Index('outbox_unpublished_idx', ['createdAt', 'id'], {
  where: '"published_at" IS NULL',
})
@Entity('outbox')
export class Outbox {
  @PrimaryColumn({
    name: 'id',
    type: 'uuid',
    default: () => 'gen_random_uuid()',
  })
  id!: string;

  @Column({ name: 'aggregate_type', type: 'text' })
  aggregateType!: string;

  @Column({ name: 'aggregate_id', type: 'text' })
  aggregateId!: string;

  @Column({ name: 'type', type: 'text' })
  type!: string;

  @Column({ name: 'payload', type: 'jsonb' })
  payload!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  // NULL means "not yet delivered" — the relay's claim query filters
  // WHERE published_at IS NULL (see the partial index above) and only sets
  // this after the broker has confirmed the publish.
  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  // Bumped on every publish attempt, not just failures — it's the
  // at-least-once counter: a row with attempts > 1 is one that was
  // redelivered to the broker (e.g. the relay crashed between publishing
  // and marking it), not necessarily one that ever failed outright.
  @Column({ name: 'attempts', type: 'int', default: 0 })
  attempts!: number;
}
