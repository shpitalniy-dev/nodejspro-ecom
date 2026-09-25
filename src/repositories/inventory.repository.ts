import type { EntityManager, Repository } from 'typeorm';

import { Inventory } from '../entities/inventory.entity.ts';

export type InventoryRepository = Repository<Inventory> & {
  decrementStock(
    productId: number,
    qty: number,
  ): Promise<{ quantity: number } | null>;
  totalQuantity(): Promise<number>;
};

// TypeORM's own Repository<Inventory>, extended (via its built-in .extend())
// with the two atomic stock operations this domain needs — not a separate
// hand-rolled class, so it keeps every base Repository method (.save(),
// .find(), .count(), ...) for free. Takes whatever EntityManager it's given
// (a fresh one per `dataSource.transaction()` call in checkout.ts, or a
// test's own `queryRunner.manager` under ROLLBACK isolation) rather than
// opening a connection of its own.
export function createInventoryRepository(
  manager: EntityManager,
): InventoryRepository {
  return manager.getRepository(Inventory).extend({
    // Same atomic guarded decrement checkout.ts always used inline: the
    // `WHERE quantity >= $1` only means anything against a real row under
    // real concurrent-safe semantics — a mock can't verify this, only a
    // real Postgres can. Returns null when there wasn't enough stock (zero
    // rows touched), never throws for that case.
    async decrementStock(productId: number, qty: number) {
      const [rows] = (await this.query(
        `UPDATE inventory
         SET quantity = quantity - $1
         WHERE product_id = $2 AND quantity >= $1
         RETURNING quantity`,
        [qty, productId],
      )) as [Array<{ quantity: number }>, number];

      return rows[0] ?? null;
    },

    // Aggregation across every product's stock — the SQL-dependent read a
    // mock has nothing to compute from.
    async totalQuantity() {
      const [{ total }] = (await this.query(
        `SELECT COALESCE(SUM(quantity), 0)::int AS total FROM inventory`,
      )) as Array<{ total: number }>;

      return total;
    },
  });
}
