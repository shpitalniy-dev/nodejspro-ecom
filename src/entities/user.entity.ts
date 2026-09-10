import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Order } from './order.entity.ts';

export type UserRole = 'user' | 'admin';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('identity', {
    name: 'id',
    type: 'int',
    generatedIdentity: 'ALWAYS',
  })
  id!: number;

  @Index('users_uuid_key', ['uuid'], { unique: true })
  @Column({ name: 'uuid', type: 'uuid', default: () => 'gen_random_uuid()' })
  uuid!: string;

  @Column({ name: 'name', type: 'text', nullable: true })
  name!: string | null;

  // No column-level UNIQUE — case-insensitive uniqueness is the
  // users_email_lower_key expression index on lower(email), added by hand to
  // the initial migration (TypeORM can't express an index over lower(email)).
  @Column({ name: 'email', type: 'text' })
  email!: string;

  @Check('users_role_check', "role IN ('user', 'admin')")
  @Column({ name: 'role', type: 'text', default: 'user' })
  role!: UserRole;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', nullable: true })
  updatedAt!: Date | null;

  @OneToMany(() => Order, order => order.user)
  orders?: Order[];
}
