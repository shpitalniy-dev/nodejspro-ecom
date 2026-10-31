import { MigrationInterface, QueryRunner } from 'typeorm';

// Generated with `typeorm migration:generate` against an empty database, then
// hand-edited for the two things the generator can't see from entity
// metadata (both marked HAND-ADDED below):
//   1. the users_email_lower_key expression index — UNIQUE on LOWER(email)
//   2. the set_updated_at() trigger function + one BEFORE UPDATE trigger
//      per table (keeps updated_at stamped on every real update)
// Both mirror db/schema.sql. down() reverses them before the generated drops.
//
// The generated CREATE TABLE / ADD CONSTRAINT statements are also
// re-wrapped one-clause-per-line for readability — the SQL is unchanged.
//
// Note: `currency` is text + CHECK (currency IN ('USD')) here, where
// db/schema.sql uses the currency_code DOMAIN — equivalent enforcement, kept
// this way so re-running migration:generate doesn't fight a domain it can't
// introspect.

const TABLES = [
  'products',
  'users',
  'inventory',
  'orders',
  'order_items',
  'fulfillments',
];

export class InitialSchema1789069491002 implements MigrationInterface {
  name = 'InitialSchema1789069491002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "inventory" (
        "id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
        "quantity" integer NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE,
        "product_id" integer NOT NULL,
        CONSTRAINT "REL_732fdb1f76432d65d2c136340d" UNIQUE ("product_id"),
        CONSTRAINT "inventory_quantity_check" CHECK (quantity >= 0),
        CONSTRAINT "PK_82aa5da437c5bbfb80703b08309" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "products" (
        "id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
        "key" text NOT NULL,
        "price_cents" bigint NOT NULL,
        "currency" text NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE,
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "products_price_cents_check" CHECK (price_cents >= 0),
        CONSTRAINT "products_currency_check" CHECK (currency IN ('USD')),
        CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "products_key_key" ON "products" ("key")
    `);
    await queryRunner.query(`
      CREATE TABLE "order_items" (
        "id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
        "key" text NOT NULL,
        "currency" text NOT NULL,
        "price_cents" bigint NOT NULL,
        "quantity" integer NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE,
        "product_id" integer NOT NULL,
        "order_id" integer NOT NULL,
        CONSTRAINT "order_items_currency_check" CHECK (currency IN ('USD')),
        CONSTRAINT "order_items_quantity_check" CHECK (quantity > 0),
        CONSTRAINT "PK_005269d8574e6fac0493715c308" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
        "uuid" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" text,
        "email" text NOT NULL,
        "role" text NOT NULL DEFAULT 'user',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "users_role_check" CHECK (role IN ('user', 'admin')),
        CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "users_uuid_key" ON "users" ("uuid")
    `);
    // HAND-ADDED: case-insensitive email uniqueness (mirrors db/schema.sql).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "users_email_lower_key" ON "users" (LOWER("email"))
    `);
    await queryRunner.query(`
      CREATE TABLE "orders" (
        "id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
        "uuid" uuid NOT NULL DEFAULT gen_random_uuid(),
        "currency" text NOT NULL,
        "amount_cents" bigint NOT NULL,
        "discount_cents" bigint NOT NULL DEFAULT '0',
        "status" text NOT NULL DEFAULT 'unpaid',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE,
        "user_id" integer NOT NULL,
        CONSTRAINT "orders_currency_check" CHECK (currency IN ('USD')),
        CONSTRAINT "orders_amount_cents_check" CHECK (amount_cents >= 0),
        CONSTRAINT "orders_discount_cents_check" CHECK (discount_cents >= 0),
        CONSTRAINT "orders_status_check" CHECK (status IN ('unpaid', 'pending', 'paid', 'refunded')),
        CONSTRAINT "discount_not_exceeding_amount" CHECK (discount_cents <= amount_cents),
        CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "orders_uuid_key" ON "orders" ("uuid")
    `);
    await queryRunner.query(`
      CREATE TABLE "fulfillments" (
        "id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
        "status" text NOT NULL DEFAULT 'pending',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE,
        "order_id" integer NOT NULL,
        CONSTRAINT "REL_ad58a06518e16ce0aa37ba1566" UNIQUE ("order_id"),
        CONSTRAINT "fulfillments_status_check" CHECK (status IN ('pending', 'processing', 'shipped', 'delivered')),
        CONSTRAINT "PK_cb1805f0398d3d001737de76df3" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "inventory"
      ADD CONSTRAINT "FK_732fdb1f76432d65d2c136340dc"
      FOREIGN KEY ("product_id") REFERENCES "products" ("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "order_items"
      ADD CONSTRAINT "FK_9263386c35b6b242540f9493b00"
      FOREIGN KEY ("product_id") REFERENCES "products" ("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "order_items"
      ADD CONSTRAINT "FK_145532db85752b29c57d2b7b1f1"
      FOREIGN KEY ("order_id") REFERENCES "orders" ("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD CONSTRAINT "FK_a922b820eeef29ac1c6800e826a"
      FOREIGN KEY ("user_id") REFERENCES "users" ("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "fulfillments"
      ADD CONSTRAINT "FK_ad58a06518e16ce0aa37ba1566e"
      FOREIGN KEY ("order_id") REFERENCES "orders" ("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION
    `);

    // HAND-ADDED: updated_at is DB-managed — a BEFORE UPDATE trigger stamps it
    // on every real update, whoever issues it. Stays NULL until then (never
    // fires on INSERT). One shared function, one trigger per table. Mirrors
    // db/schema.sql.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
        BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
        END;
      $$ LANGUAGE plpgsql
    `);

    for (const table of TABLES) {
      await queryRunner.query(`
        CREATE TRIGGER "${table}_set_updated_at" BEFORE UPDATE ON "${table}"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // HAND-ADDED reversal — triggers first (they depend on the function),
    // then the function, then the expression index.
    for (const table of TABLES) {
      await queryRunner.query(`
        DROP TRIGGER IF EXISTS "${table}_set_updated_at" ON "${table}"
      `);
    }

    await queryRunner.query(`DROP FUNCTION IF EXISTS set_updated_at()`);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."users_email_lower_key"
    `);

    await queryRunner.query(`
      ALTER TABLE "fulfillments" DROP CONSTRAINT "FK_ad58a06518e16ce0aa37ba1566e"
    `);
    await queryRunner.query(`
      ALTER TABLE "orders" DROP CONSTRAINT "FK_a922b820eeef29ac1c6800e826a"
    `);
    await queryRunner.query(`
      ALTER TABLE "order_items" DROP CONSTRAINT "FK_145532db85752b29c57d2b7b1f1"
    `);
    await queryRunner.query(`
      ALTER TABLE "order_items" DROP CONSTRAINT "FK_9263386c35b6b242540f9493b00"
    `);
    await queryRunner.query(`
      ALTER TABLE "inventory" DROP CONSTRAINT "FK_732fdb1f76432d65d2c136340dc"
    `);
    await queryRunner.query(`DROP TABLE "fulfillments"`);
    await queryRunner.query(`DROP INDEX "public"."orders_uuid_key"`);
    await queryRunner.query(`DROP TABLE "orders"`);
    await queryRunner.query(`DROP INDEX "public"."users_uuid_key"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TABLE "order_items"`);
    await queryRunner.query(`DROP INDEX "public"."products_key_key"`);
    await queryRunner.query(`DROP TABLE "products"`);
    await queryRunner.query(`DROP TABLE "inventory"`);
  }
}
