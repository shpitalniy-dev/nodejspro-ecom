import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Index(
  'processed_messages_message_id_consumer_key',
  ['messageId', 'consumer'],
  {
    unique: true,
  },
)
@Entity('processed_messages')
export class ProcessedMessage {
  @PrimaryGeneratedColumn('identity', {
    name: 'id',
    type: 'int',
    generatedIdentity: 'ALWAYS',
  })
  id!: number;

  @Column({ name: 'message_id', type: 'text' })
  messageId!: string;

  // Which consumer processed it — a second consumer of the same event
  // (e.g. an analytics projection added later) gets its own row, not a
  // collision with the fulfilment worker's.
  @Column({ name: 'consumer', type: 'text' })
  consumer!: string;

  @CreateDateColumn({ name: 'processed_at', type: 'timestamptz' })
  processedAt!: Date;
}
