import { MigrationInterface, QueryRunner } from 'typeorm';

// Generated with `typeorm migration:generate` against the InitialSchema
// baseline, then hand-edited to drop four spurious ALTER COLUMN ... DEFAULT
// statements the generator emitted for users.uuid / orders.uuid — it diffs
// gen_random_uuid() against a hardcoded uuid_generate_v4() fallback it never
// actually introspected from this DB (which doesn't have the uuid-ossp
// extension at all — see `SELECT proname FROM pg_proc WHERE proname LIKE
// '%uuid%'`), so down() would have failed outright on a function that
// doesn't exist. No real diff here — confirmed by re-running
// migration:generate after applying this one and getting an empty diff.
//
// tasks has no FK to orders on purpose — it's a generic queue, not owned by
// any one domain table (see task.entity.ts); `type` says what a task is,
// `payload` carries whatever context that type needs. So this table gets no
// set_updated_at trigger wiring beyond what the generator already emits —
// there's nothing hand-added here, unlike InitialSchema.
//
// The generated CREATE TABLE / ADD CONSTRAINT statements are re-wrapped
// one-clause-per-line for readability, same as InitialSchema — SQL itself
// is unchanged.

export class AddBalanceAndTasks1789154908973 implements MigrationInterface {
  name = 'AddBalanceAndTasks1789154908973';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tasks" (
        "id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
        "type" text NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}',
        "status" text NOT NULL DEFAULT 'pending',
        "worker" text,
        "processed" integer NOT NULL DEFAULT '0',
        "attempts" integer NOT NULL DEFAULT '0',
        "last_error" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "tasks_status_check" CHECK (status IN ('pending', 'done', 'failed')),
        CONSTRAINT "tasks_attempts_check" CHECK (attempts >= 0),
        CONSTRAINT "PK_8d12ff38fcc62aaba2cab748772" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "tasks_status_idx" ON "tasks" ("status")
    `);
    await queryRunner.query(`
      ALTER TABLE "users" ADD "balance_cents" bigint NOT NULL DEFAULT '0'
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD CONSTRAINT "users_balance_cents_check" CHECK (balance_cents >= 0)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" DROP CONSTRAINT "users_balance_cents_check"
    `);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "balance_cents"`);
    await queryRunner.query(`DROP INDEX "public"."tasks_status_idx"`);
    await queryRunner.query(`DROP TABLE "tasks"`);
  }
}
