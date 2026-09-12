import { MigrationInterface, QueryRunner } from 'typeorm';

// Postgres never indexes a foreign-key column automatically — order_id and
// product_id on order_items had nothing but the implicit PK index (on id)
// until now, confirmed via `pg_indexes`. Every join through either column
// (the N+1 fix's relations/relationLoadStrategy paths, report.ts's own
// joins) was a seq scan waiting to happen the moment the table isn't tiny.
//
// Same spurious ALTER COLUMN ... DEFAULT noise as InitialSchema — the
// generator diffs gen_random_uuid() against a hardcoded uuid_generate_v4()
// fallback it never actually introspected (this DB has no uuid-ossp
// extension), so down() would have failed outright on a function that
// doesn't exist. Dropped both directions; no real diff there.

export class AddOrderItemsIndexes1789231614310 implements MigrationInterface {
  name = 'AddOrderItemsIndexes1789231614310';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "order_items_order_id_idx" ON "order_items" ("order_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "order_items_product_id_idx" ON "order_items" ("product_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."order_items_product_id_idx"`);
    await queryRunner.query(`DROP INDEX "public"."order_items_order_id_idx"`);
  }
}
