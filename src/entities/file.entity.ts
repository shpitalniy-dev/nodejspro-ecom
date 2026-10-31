import {
  Check,
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

export type FileStatus = 'pending' | 'completed';

// HW #26, slice 1 — see migrations/1789600000000-AddFiles.ts for the schema
// rationale.
@Entity('files')
export class File {
  @PrimaryGeneratedColumn('identity', {
    name: 'id',
    type: 'int',
    generatedIdentity: 'ALWAYS',
  })
  id!: number;

  @Index('files_uuid_key', ['uuid'], { unique: true })
  @Column({ name: 'uuid', type: 'uuid', default: () => 'gen_random_uuid()' })
  uuid!: string;

  @Index('files_key_key', ['key'], { unique: true })
  @Column({ name: 'key', type: 'text' })
  key!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'owner_id' })
  owner!: Relation<User>;

  @Check('files_status_check', "status IN ('pending', 'completed')")
  @Column({ name: 'status', type: 'text', default: 'pending' })
  status!: FileStatus;

  // Only known once commit() reads it back via HeadObject — the verified
  // fact, checked against declaredSize below.
  @Column({ name: 'size', type: 'bigint', nullable: true })
  size!: string | null;

  // The client's claimed size at intent time (now mandatory — see
  // files.dto.ts). commit() rejects (422) if the real size doesn't match.
  @Column({ name: 'declared_size', type: 'bigint' })
  declaredSize!: string;

  // Set by createIntent()'s multipart branch (size >= MULTIPART_THRESHOLD_BYTES).
  @Column({ name: 'upload_id', type: 'text', nullable: true })
  uploadId!: string | null;

  // Multipart-only — null on single-PUT rows. resumeUpload() needs these to
  // know "how many parts, how big" without the client repeating them.
  @Column({ name: 'part_size', type: 'bigint', nullable: true })
  partSize!: string | null;

  @Column({ name: 'part_count', type: 'int', nullable: true })
  partCount!: number | null;

  @Column({ name: 'content_type', type: 'text' })
  contentType!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
