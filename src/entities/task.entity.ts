import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Generic post-processing queue — deliberately independent of any domain
// table (no FK to orders). A row's `type` says what it is and `payload`
// carries whatever context that type needs (e.g. { orderId } for a
// receipt/email task); the worker pool that drains this table doesn't need
// to know anything about orders at all. One held transaction per task —
// claim (FOR UPDATE SKIP LOCKED) and completion commit together, so a
// worker crash before COMMIT just returns the task to 'pending' for free
// (see README's Concurrency section). A failed attempt uses a SAVEPOINT to
// keep the attempts/last_error bump without keeping whatever partial work
// the task attempted.
export type TaskStatus = 'pending' | 'done' | 'failed';

@Entity('tasks')
export class Task {
  @PrimaryGeneratedColumn('identity', {
    name: 'id',
    type: 'int',
    generatedIdentity: 'ALWAYS',
  })
  id!: number;

  @Column({ name: 'type', type: 'text' })
  type!: string;

  @Column({ name: 'payload', type: 'jsonb', default: () => "'{}'" })
  payload!: Record<string, unknown>;

  @Index('tasks_status_idx', ['status'])
  @Check('tasks_status_check', "status IN ('pending', 'done', 'failed')")
  @Column({ name: 'status', type: 'text', default: 'pending' })
  status!: TaskStatus;

  // Identifies which worker last claimed the task — purely observational
  // (the FOR UPDATE lock, not this column, is what prevents double claims).
  @Column({ name: 'worker', type: 'text', nullable: true })
  worker!: string | null;

  // Incremented only on a successful completion. Used to prove
  // exactly-once processing: demo:workers asserts this never exceeds 1.
  @Column({ name: 'processed', type: 'int', default: 0 })
  processed!: number;

  // Incremented on every claim that ends in failure (via SAVEPOINT, so the
  // bump survives even though the attempted work itself is rolled back).
  @Check('tasks_attempts_check', 'attempts >= 0')
  @Column({ name: 'attempts', type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', nullable: true })
  updatedAt!: Date | null;
}
