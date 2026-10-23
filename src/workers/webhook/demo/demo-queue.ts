import type { Job } from 'bullmq';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';

import { requireEnv } from '../../../utils/require-env.ts';
import { sleep } from '../../../utils/sleep.ts';
import { waitUntil } from '../../../utils/wait-until.ts';

// demo:queue — BullMQ mechanics (HW #23 point 5): retry with exponential
// backoff, jobId dedup, and a scheduler via upsertJobScheduler. No DB, no
// outbox, no HTTP — same self-contained convention as
// demo-cache.ts/demo-session.ts/demo-rate-limit.ts. Mirrors the course
// lecture's own 08-bullmq.ts shape.

const QUEUE_NAME = 'demo-queue';
const RETRY_JOB_NAME = 'demo-retry-job';
const DEDUPE_JOB_NAME = 'demo-dedupe-job';
const SCHEDULED_JOB_NAME = 'demo-scheduled-job';
const SCHEDULER_ID = 'demo-scheduler';
const SCHEDULER_EVERY_MS = 250;
const SCHEDULER_WAIT_MS = 2000; // ~8x margin over the 2 ticks required

async function main(): Promise<void> {
  const url = requireEnv('REDIS_QUEUE_URL');

  // Two independent sockets, both maxRetriesPerRequest: null — same
  // Queue-vs-Worker constraint as the real webhook module (see
  // redis.factory.ts): a Worker's blocking commands must never share a
  // connection with the Queue's own add() calls.
  const producerConnection = new Redis(url, { maxRetriesPerRequest: null });
  const consumerConnection = new Redis(url, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE_NAME, { connection: producerConnection });

  let completed = 0;
  let scheduledRuns = 0;

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      if (job.name === RETRY_JOB_NAME && job.attemptsMade < 2) {
        throw new Error(
          `demo:queue forced failure, attempt ${job.attemptsMade + 1}`,
        );
      }

      if (job.name === SCHEDULED_JOB_NAME) {
        scheduledRuns++;
      }
    },
    { connection: consumerConnection },
  );

  worker.on('completed', job => {
    if (job.name === RETRY_JOB_NAME) {
      completed++;
    }
  });

  try {
    const [, maxmemoryPolicy] = (await producerConnection.config(
      'GET',
      'maxmemory-policy',
    )) as unknown as string[];
    const queueNoeviction = maxmemoryPolicy === 'noeviction' ? 1 : 0;

    // attempts >= 3 — fails twice, succeeds on the 3rd try.
    const retryJobId = `retry-${randomUUID()}`;
    await queue.add(
      RETRY_JOB_NAME,
      {},
      {
        jobId: retryJobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 200, jitter: 0.5 },
      },
    );
    await waitUntil(async () => completed === 1, 20_000);
    const attempts = (await queue.getJob(retryJobId))?.attemptsMade ?? 0;

    // added=2, queued=1 — same jobId twice; removeOnComplete MUST NOT be
    // `true` (disables dedup on completion, per BullMQ's own documented
    // warning).
    const dedupeJobId = `dedupe-${randomUUID()}`;
    const first = await queue.add(
      DEDUPE_JOB_NAME,
      { n: 1 },
      { jobId: dedupeJobId, removeOnComplete: { age: 3600 } },
    );
    const second = await queue.add(
      DEDUPE_JOB_NAME,
      { n: 2 },
      { jobId: dedupeJobId, removeOnComplete: { age: 3600 } },
    );
    const added = 2;
    const queued = first.id === second.id ? 1 : 2;

    // schedulers >= 1, scheduled-runs >= 2 — upsertJobScheduler called
    // twice ON PURPOSE to prove upsert (same scheduler, not a 2nd one).
    await queue.upsertJobScheduler(
      SCHEDULER_ID,
      { every: SCHEDULER_EVERY_MS },
      { name: SCHEDULED_JOB_NAME },
    );
    await queue.upsertJobScheduler(
      SCHEDULER_ID,
      { every: SCHEDULER_EVERY_MS },
      { name: SCHEDULED_JOB_NAME },
    );
    const schedulers = (await queue.getJobSchedulers()).length;

    // Real wall-clock wait — unavoidable here, unlike demo-ratelimit's
    // tiny-refill-rate determinism trick: proving a scheduler fires more
    // than once needs it to actually fire more than once in real time.
    await sleep(SCHEDULER_WAIT_MS);

    console.log(
      'demo:queue — BullMQ mechanics: retry/backoff, jobId dedup, job schedulers',
    );
    console.log(`queue-noeviction=${queueNoeviction}`);
    console.log(`attempts=${attempts}`);
    console.log(`completed=${completed}`);
    console.log(`added=${added}`);
    console.log(`queued=${queued}`);
    console.log(`schedulers=${schedulers}`);
    console.log(`scheduled-runs=${scheduledRuns}`);

    const invariantOk =
      queueNoeviction === 1 &&
      attempts >= 3 &&
      completed === 1 &&
      added === 2 &&
      queued === 1 &&
      schedulers >= 1 &&
      scheduledRuns >= 2;

    if (invariantOk) {
      console.log(
        'invariant check passed — retry/backoff, jobId dedup, and job schedulers all behave as documented',
      );
    } else {
      console.error('invariant check FAILED');
      process.exitCode = 1;
    }
  } finally {
    await queue.removeJobScheduler(SCHEDULER_ID).catch(() => undefined);
    await worker.close().catch(() => undefined);
    await queue.close().catch(() => undefined);
    await producerConnection.quit().catch(() => undefined);
    await consumerConnection.quit().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
