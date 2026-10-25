import { MigrationInterface, QueryRunner } from 'typeorm';

// HW #24, slice 2. id+uuid split matches every other table here
// (users/orders) — id is the internal working key (claim UPDATE,
// grace-cache key), uuid is this row's own stable identity. The partial
// index on family_id mirrors the lecture's own schema: revocation and
// reuse-detection lookups only ever care about the live (unrevoked) rows
// of a family.
export class AddRefreshTokens1789500000000 implements MigrationInterface {
  name = 'AddRefreshTokens1789500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
        "uuid" uuid NOT NULL DEFAULT gen_random_uuid(),
        "family_id" uuid NOT NULL,
        "user_id" integer NOT NULL,
        "token_hash" text NOT NULL,
        "used_at" TIMESTAMP WITH TIME ZONE,
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "absolute_expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_refresh_tokens_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
      ADD CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4" FOREIGN KEY ("user_id")
      REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "refresh_tokens_uuid_key" ON "refresh_tokens" ("uuid")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens" ("token_hash")
    `);
    await queryRunner.query(`
      CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens" ("family_id")
      WHERE "revoked_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "public"."refresh_tokens_family_id_idx"
    `);
    await queryRunner.query(`
      DROP INDEX "public"."refresh_tokens_token_hash_key"
    `);
    await queryRunner.query(`
      DROP INDEX "public"."refresh_tokens_uuid_key"
    `);
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4"
    `);
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
  }
}
