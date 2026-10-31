import { MigrationInterface, QueryRunner } from 'typeorm';

// HW #26, slice 1 (demo:upload). id+uuid split matches every other table
// here. `key` is the generated object key (uploads/{ownerUuid}/{uuid}.ext) —
// unique, since it's also how `commit()` finds the object in storage.
// `status` starts 'pending' at intent time and only a successful
// HeadObject-backed commit() moves it to 'completed' — see files.service.ts.
// `upload_id` is unused by this slice (nullable); it's populated by the
// multipart slice's CreateMultipartUpload, included now so the shape
// doesn't change again there.
export class AddFiles1789600000000 implements MigrationInterface {
  name = 'AddFiles1789600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "files" (
        "id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
        "uuid" uuid NOT NULL DEFAULT gen_random_uuid(),
        "key" text NOT NULL,
        "owner_id" integer NOT NULL,
        "status" text NOT NULL DEFAULT 'pending',
        "size" bigint,
        "upload_id" text,
        "content_type" text NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_files_id" PRIMARY KEY ("id"),
        CONSTRAINT "files_status_check" CHECK ("status" IN ('pending', 'completed'))
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "files"
      ADD CONSTRAINT "FK_files_owner_id" FOREIGN KEY ("owner_id")
      REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "files_uuid_key" ON "files" ("uuid")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "files_key_key" ON "files" ("key")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "public"."files_key_key"
    `);
    await queryRunner.query(`
      DROP INDEX "public"."files_uuid_key"
    `);
    await queryRunner.query(`
      ALTER TABLE "files" DROP CONSTRAINT "FK_files_owner_id"
    `);
    await queryRunner.query(`DROP TABLE "files"`);
  }
}
