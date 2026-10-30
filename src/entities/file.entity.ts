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

  // Only known once commit() reads it back via HeadObject.
  @Column({ name: 'size', type: 'bigint', nullable: true })
  size!: string | null;

  // Unused by this slice — populated by the multipart slice's
  // CreateMultipartUpload.
  @Column({ name: 'upload_id', type: 'text', nullable: true })
  uploadId!: string | null;

  @Column({ name: 'content_type', type: 'text' })
  contentType!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
