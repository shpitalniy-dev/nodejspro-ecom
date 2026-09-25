import type { DataSource, QueryRunner } from 'typeorm';

// ROLLBACK isolation: one reserved connection per test, wrapped in a
// transaction that's never committed. Every repository call in the test
// runs through `queryRunner.manager` — the same EntityManager shape
// checkout.ts already passes its own repositories — so nothing it does
// survives past rollbackTx(), and the suite is green on repeated runs with
// no manual cleanup.
export async function beginTx(dataSource: DataSource): Promise<QueryRunner> {
  const queryRunner = dataSource.createQueryRunner();

  await queryRunner.connect();
  await queryRunner.startTransaction();

  return queryRunner;
}

export async function rollbackTx(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.rollbackTransaction();
  await queryRunner.release();
}
