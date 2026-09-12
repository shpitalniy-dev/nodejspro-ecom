import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import { dataSourceOptions } from '../data-source.ts';
import { Task } from '../entities/task.entity.ts';

// A worker pool draining a task queue via FOR UPDATE SKIP LOCKED — deliberate
// mirror-image of checkout.ts's raw-SQL atomic UPDATE: this uses TypeORM's
// own QueryBuilder lock API (setLock/setOnLocked) instead, so the submission
// demonstrates both primitives rather than picking one style everywhere.
//
// Promise-based workers (async functions in one process), not separate OS
// processes: the correctness this proves (exactly-once claiming) is a
// Postgres guarantee, identical either way — the workers here just hold
// their own pooled connection each, so Postgres sees genuinely independent
// concurrent sessions even though the calling process is single-threaded.

const BATCH_SIZE = 20;
const WORKER_COUNT = 4;
const WORK_MS = 150;
const WORK_JITTER_MS = 40;
const RETRY_PAUSE_MS = 20;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// A perfectly deterministic delay here (plain `sleep(WORK_MS)`, tried
// first) turned out to badly skew the distribution: with 4 async functions
// sharing one event loop and zero timing variance, Node's timer queue
// resolves same-delay timers in a persistently biased FIFO order, so
// whichever worker's timer was scheduled a fraction earlier during setup
// kept winning the race back to claimOne every single round — a real run
// produced a 12/7/1/0 split, not the roughly-even one you'd expect. Real
// I/O always has natural jitter that would interleave workers fairly on
// its own; this simulated work needs a bit of it too.
function simulateWork(): Promise<void> {
  return sleep(WORK_MS + Math.floor(Math.random() * WORK_JITTER_MS));
}

// One held transaction per task: claim (lock) and completion commit
// together, so a worker crash before COMMIT just returns the task to
// 'pending' for free — nothing else to clean up. Returns null when nothing
// claimable was found *right now* — see countClaimable() below for why
// that's not the same as "the batch is empty".
async function claimOne(
  ds: DataSource,
  batchId: string,
  worker: string,
): Promise<{ id: number } | null> {
  return ds.transaction(async manager => {
    // .limit(1) is not optional here: .getOne() alone does NOT add a SQL
    // LIMIT — it just takes the first row of the *whole* matching result
    // set in JS. Combined with FOR UPDATE SKIP LOCKED that's a real
    // correctness bug, not just waste: the lock applies to every matching
    // row, not only the one returned. Verified directly — without
    // .limit(1), whichever transaction's query ran first locked all
    // pending rows in the batch at once (confirmed via .getSql()), leaving
    // the other 3 workers nothing to claim until it committed. A real run
    // showed exactly that: one worker monopolizing a long streak per
    // "round" and total time barely beating the sequential estimate
    // despite 4-way concurrency.
    const task = await manager
      .createQueryBuilder(Task, 'task')
      .setLock('pessimistic_write')
      .setOnLocked('skip_locked')
      .where(
        "task.status = 'pending' AND task.availableAt <= now() AND task.payload->>'batch' = :batchId",
        { batchId },
      )
      .orderBy('task.id', 'ASC')
      .limit(1)
      .getOne();

    if (!task) {
      return null;
    }

    await simulateWork();

    await manager.getRepository(Task).update(task.id, {
      status: 'done',
      worker,
      processed: task.processed + 1,
    });

    return { id: task.id };
  });
}

// Deliberately mirrors claimOne's own WHERE (minus the lock): counting
// "any pending row" here would include the delayed task forever, since it
// stays status='pending' for its whole 2h window — that would make workers
// loop forever waiting for something that isn't meant to be claimed in this
// demo's lifetime. "Nothing left to do" has to mean "nothing left that's
// actually due", not "nothing left with this status".
async function countClaimable(
  ds: DataSource,
  batchId: string,
): Promise<number> {
  return ds
    .createQueryBuilder(Task, 'task')
    .where(
      "task.status = 'pending' AND task.availableAt <= now() AND task.payload->>'batch' = :batchId",
      { batchId },
    )
    .getCount();
}

// SKIP LOCKED returning nothing means "nothing free right now" — with 4
// workers racing near the end of the batch, that's the common case, not the
// exception. Only stop once a real count confirms nothing pending remains.
async function runWorker(
  ds: DataSource,
  name: string,
  batchId: string,
): Promise<number> {
  let claimed = 0;

  for (;;) {
    const task = await claimOne(ds, batchId, name);

    if (task) {
      claimed++;
      continue;
    }

    if ((await countClaimable(ds, batchId)) === 0) {
      break;
    }

    await sleep(RETRY_PAUSE_MS);
  }

  return claimed;
}

async function main(): Promise<void> {
  const ds = new DataSource({ ...dataSourceOptions });

  await ds.initialize();

  try {
    const batchId = randomUUID();

    const normalRows = Array.from({ length: BATCH_SIZE }, (_, n) => ({
      type: 'demo.load-test',
      payload: { batch: batchId, n },
    }));

    // One task scheduled 2h out, in the same batch — proves the worker's
    // own claim query actually enforces available_at, not just that
    // checkout.ts sets it (see task.entity.ts / checkout.ts).
    const delayedRow = {
      type: 'demo.load-test',
      payload: { batch: batchId, n: BATCH_SIZE, delayed: true },
      availableAt: () => "now() + interval '2 hours'",
    };

    await ds
      .createQueryBuilder()
      .insert()
      .into(Task)
      .values([...normalRows, delayedRow])
      .execute();

    console.log(
      `demo:workers — ${BATCH_SIZE} tasks + 1 delayed, ${WORKER_COUNT} workers, ${WORK_MS}ms/task\n`,
    );

    const workerNames = Array.from(
      { length: WORKER_COUNT },
      (_, i) => `worker-${i + 1}`,
    );

    const start = Date.now();
    const claimedPerWorker = await Promise.all(
      workerNames.map(name => runWorker(ds, name, batchId)),
    );
    const elapsedMs = Date.now() - start;
    const sequentialEstimateMs = BATCH_SIZE * WORK_MS;

    // Cross-check the in-process tally against the DB's own record of who
    // claimed what, rather than trusting either source alone.
    const distribution = await ds
      .createQueryBuilder(Task, 'task')
      .select('task.worker', 'worker')
      .addSelect('COUNT(*)', 'n')
      .where("task.status = 'done' AND task.payload->>'batch' = :batchId", {
        batchId,
      })
      .groupBy('task.worker')
      .getRawMany<{ worker: string; n: string }>();
    const distributionByWorker = new Map(
      distribution.map(row => [row.worker, Number(row.n)]),
    );

    const doneCount = await ds
      .createQueryBuilder(Task, 'task')
      .where("task.status = 'done' AND task.payload->>'batch' = :batchId", {
        batchId,
      })
      .getCount();

    const processedTwice = await ds
      .createQueryBuilder(Task, 'task')
      .where("task.processed > 1 AND task.payload->>'batch' = :batchId", {
        batchId,
      })
      .getCount();

    const delayedTask = await ds
      .createQueryBuilder(Task, 'task')
      .where(
        "task.payload->>'batch' = :batchId AND (task.payload->>'delayed')::boolean = true",
        { batchId },
      )
      .getOneOrFail();

    console.log('distribution (claimed / recorded in DB):');

    for (const [name, count] of workerNames.map(
      (name, i) => [name, claimedPerWorker[i]] as const,
    )) {
      console.log(
        `  ${name.padEnd(10)} ${count} / ${distributionByWorker.get(name) ?? 0}`,
      );
    }

    console.log(`\nprocessed twice:   ${processedTwice}`);
    console.log(`done:              ${doneCount} / ${BATCH_SIZE}`);
    console.log(
      `delayed task:      status=${delayedTask.status} processed=${delayedTask.processed} (expected pending/0)`,
    );
    console.log(
      `elapsed:           ${elapsedMs}ms (sequential estimate: ${sequentialEstimateMs}ms)\n`,
    );

    const distributionMatches = workerNames.every(
      (name, i) =>
        claimedPerWorker[i] === (distributionByWorker.get(name) ?? 0),
    );

    const ok =
      processedTwice === 0 &&
      doneCount === BATCH_SIZE &&
      delayedTask.status === 'pending' &&
      delayedTask.processed === 0 &&
      elapsedMs < sequentialEstimateMs &&
      distributionMatches;

    if (ok) {
      console.log(
        'invariant check passed — exactly-once processing, delayed task correctly skipped, faster than sequential',
      );
    } else {
      console.error('invariant check FAILED');
      process.exitCode = 1;
    }
  } finally {
    await ds.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
