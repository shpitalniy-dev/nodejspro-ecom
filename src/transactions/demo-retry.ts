import 'reflect-metadata';

import { DataSource } from 'typeorm';

import { dataSourceOptions } from '../data-source.ts';
import { User } from '../entities/user.entity.ts';

import { withRetry } from './with-retry.ts';

// Two scenarios provoking a real serialization failure, both driven through
// the same withRetry helper, to prove it's isolation-level-agnostic:
//
//   A. REPEATABLE READ — two concurrent read-modify-writes on the SAME row
//      (users.balance_cents). RR can see the direct conflict: the second
//      commit finds its snapshot stale against the first's write, and
//      throws 40001 right there.
//
//   B. SERIALIZABLE — write skew (only SERIALIZABLE catches this, not RR):
//      two admins each check "are there >=2 admins?" and, if so, demote
//      THEMSELVES. Neither transaction's write touches the row the other
//      read, so RR would let both through silently, leaving zero admins —
//      a real invariant violation with no error at all. SERIALIZABLE
//      tracks the read/write dependency (not just row conflicts) and
//      aborts the second one at COMMIT with 40001. The retry then matters
//      for a different reason than in scenario A: on retry, the callback
//      re-reads the count fresh (now 1) and correctly REFUSES to demote —
//      retrying the whole transaction, not just the write, is what makes
//      that correct refusal possible.

const BUYER_EMAIL = 'demo-buyer@seed.example';
const BASELINE_BALANCE_CENTS = 100000n; // $1,000
const DELTA_A = 5000n; // +$50
const DELTA_B = -3000n; // -$30
const THINK_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function adjustBalance(
  ds: DataSource,
  userId: number,
  deltaCents: bigint,
): Promise<number> {
  const { retries } = await withRetry(ds, 'REPEATABLE READ', async manager => {
    const user = await manager.getRepository(User).findOneByOrFail({
      id: userId,
    });

    await sleep(THINK_MS); // the overlap window — both reads happen before either write

    const newBalance = BigInt(user.balanceCents) + deltaCents;

    await manager
      .getRepository(User)
      .update(userId, { balanceCents: newBalance.toString() });
  });

  return retries;
}

async function tryDemote(
  ds: DataSource,
  userId: number,
): Promise<{ demoted: boolean; retries: number }> {
  const { result, retries } = await withRetry(
    ds,
    'SERIALIZABLE',
    async manager => {
      const adminCount = await manager.getRepository(User).countBy({
        role: 'admin',
      });

      await sleep(THINK_MS);

      if (adminCount < 2) {
        return false; // invariant would break — refuse, not an error
      }

      await manager.getRepository(User).update(userId, { role: 'user' });

      return true;
    },
  );

  return { demoted: result, retries };
}

async function main(): Promise<void> {
  const ds = new DataSource({ ...dataSourceOptions });

  await ds.initialize();

  try {
    const buyer = await ds
      .getRepository(User)
      .findOneByOrFail({ email: BUYER_EMAIL });
    const alice = await ds
      .getRepository(User)
      .findOneByOrFail({ email: 'alice@seed.example' });
    const bob = await ds
      .getRepository(User)
      .findOneByOrFail({ email: 'bob@seed.example' });

    // Reset to a known baseline so this demo is rerunnable without reseeding.
    await ds
      .getRepository(User)
      .update(buyer.id, { balanceCents: BASELINE_BALANCE_CENTS.toString() });
    await ds.getRepository(User).update([alice.id, bob.id], { role: 'admin' });

    console.log('demo:retry\n');
    console.log(
      'scenario A — REPEATABLE READ: concurrent balance read-modify-write',
    );

    const [retriesA1, retriesA2] = await Promise.all([
      adjustBalance(ds, buyer.id, DELTA_A),
      adjustBalance(ds, buyer.id, DELTA_B),
    ]);

    const finalBuyer = await ds
      .getRepository(User)
      .findOneByOrFail({ id: buyer.id });
    const expectedBalance = BASELINE_BALANCE_CENTS + DELTA_A + DELTA_B;
    const retriesA = retriesA1 + retriesA2;

    console.log(
      `  op +$50: retries=${retriesA1}   op -$30: retries=${retriesA2}`,
    );
    console.log(
      `  final balance_cents: ${finalBuyer.balanceCents} (expected ${expectedBalance})\n`,
    );

    console.log(
      'scenario B — SERIALIZABLE: concurrent admin self-demotion (write skew)',
    );

    const [aliceOutcome, bobOutcome] = await Promise.all([
      tryDemote(ds, alice.id),
      tryDemote(ds, bob.id),
    ]);

    const finalAdminCount = await ds.getRepository(User).countBy({
      role: 'admin',
    });
    const retriesB = aliceOutcome.retries + bobOutcome.retries;

    console.log(
      `  alice demoted=${aliceOutcome.demoted} retries=${aliceOutcome.retries}   bob demoted=${bobOutcome.demoted} retries=${bobOutcome.retries}`,
    );
    console.log(`  final admin count: ${finalAdminCount} (expected 1)\n`);

    const exactlyOneDemoted =
      [aliceOutcome.demoted, bobOutcome.demoted].filter(Boolean).length === 1;

    const ok =
      finalBuyer.balanceCents === expectedBalance.toString() &&
      retriesA >= 1 &&
      finalAdminCount === 1 &&
      exactlyOneDemoted &&
      retriesB >= 1;

    if (ok) {
      console.log(
        'invariant check passed — both scenarios recovered from a real serialization failure with a correct final state',
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
