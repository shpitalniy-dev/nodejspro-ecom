import { MigrationInterface, QueryRunner } from 'typeorm';

// HW #24 — nullable because most seed users (alice/bob/carol/...) never log
// in through this endpoint; only the demo-buyer fixture gets a real hash,
// set by seed.ts via PasswordService at seed time. Stores the argon2id PHC
// string as-is (algorithm, version, memoryCost/timeCost/parallelism, salt
// and hash all encoded together) — nothing else to store alongside it, no
// separate salt/pepper column, unlike the refresh-token hash this homework
// also needs (future slice).
export class AddUserPasswordHash1789400000000 implements MigrationInterface {
  name = 'AddUserPasswordHash1789400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" ADD "password_hash" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "password_hash"`);
  }
}
