import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOutboxAndProcessedMessages1789300000000
  implements MigrationInterface
{
  name = 'AddOutboxAndProcessedMessages1789300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "outbox" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "aggregate_type" text NOT NULL,
        "aggregate_id" text NOT NULL,
        "type" text NOT NULL,
        "payload" jsonb NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "published_at" TIMESTAMP WITH TIME ZONE,
        "attempts" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_outbox_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "outbox_unpublished_idx" ON "outbox" ("created_at", "id")
      WHERE "published_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "processed_messages" (
        "id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
        "message_id" text NOT NULL,
        "consumer" text NOT NULL,
        "processed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_processed_messages_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "processed_messages_message_id_consumer_key"
        ON "processed_messages" ("message_id", "consumer")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "public"."processed_messages_message_id_consumer_key"
    `);
    await queryRunner.query(`DROP TABLE "processed_messages"`);

    await queryRunner.query(`DROP INDEX "public"."outbox_unpublished_idx"`);
    await queryRunner.query(`DROP TABLE "outbox"`);
  }
}
