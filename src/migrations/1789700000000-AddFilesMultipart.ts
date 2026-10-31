import { MigrationInterface, QueryRunner } from 'typeorm';

// HW #26, slice 2 (demo:multipart). `part_size`/`part_count` are only set on
// the multipart branch of createIntent() — resumeUpload() needs them to
// know how many parts exist without asking the client to repeat a number
// it was only told once. `declared_size` is new for both branches: the
// client's claimed size at intent time, checked against the real,
// storage-reported size at commit() — see files.service.ts.
export class AddFilesMultipart1789700000000 implements MigrationInterface {
  name = 'AddFilesMultipart1789700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "files"
      ADD COLUMN "part_size" bigint,
      ADD COLUMN "part_count" integer,
      ADD COLUMN "declared_size" bigint NOT NULL DEFAULT 0
    `);
    // Backfill any pre-existing row (the default 0 above would otherwise
    // fail the CHECK added below) from its own verified size where known.
    await queryRunner.query(`
      UPDATE "files" SET "declared_size" = GREATEST(COALESCE("size", 1), 1)
    `);
    await queryRunner.query(`
      ALTER TABLE "files" ALTER COLUMN "declared_size" DROP DEFAULT
    `);
    await queryRunner.query(`
      ALTER TABLE "files"
      ADD CONSTRAINT "files_declared_size_check" CHECK ("declared_size" > 0)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "files" DROP CONSTRAINT "files_declared_size_check"
    `);
    await queryRunner.query(`
      ALTER TABLE "files"
      DROP COLUMN "part_size",
      DROP COLUMN "part_count",
      DROP COLUMN "declared_size"
    `);
  }
}
