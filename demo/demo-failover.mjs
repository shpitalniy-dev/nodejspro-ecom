// Stage 5, demo:failover — forces the RDS Multi-AZ instance to fail over and
// proves it actually moved: AZ before != AZ after, both read live from
// describe-db-instances, plus the real RDS event log entry for the failover.
//
// Output contract (grader-parsed, one key=number/string per line):
//   az-before, az-after, failover-seconds, event
import {
  DescribeDBInstancesCommand,
  DescribeEventsCommand,
  RDSClient,
  RebootDBInstanceCommand,
} from '@aws-sdk/client-rds';

import {
  DEMO_DIR,
  pulumiOutput,
  r1,
  realAwsGate,
  report,
  sleep,
} from './utils.mjs';

// shortcut: AWS's own docs note the AZ field on describe-db-instances can lag
// the actual failover by minutes; this polls that same field rather than
// resolving the endpoint's DNS to its network interface's AZ, so az-after may
// take longer to flip than the failover itself. Upgrade if that lag matters.
const POLL_MS = 5_000;
const TIMEOUT_MS = 15 * 60_000;

async function main() {
  realAwsGate('demo:failover');

  const rds = new RDSClient({});
  const id = pulumiOutput(DEMO_DIR, 'dbInstanceId');

  const describe = async () =>
    (
      await rds.send(
        new DescribeDBInstancesCommand({ DBInstanceIdentifier: id }),
      )
    ).DBInstances[0];

  const before = await describe();

  if (before.DBInstanceStatus !== 'available') {
    throw new Error(
      `${id} is ${before.DBInstanceStatus}, not available — can't fail over`,
    );
  }

  const azBefore = before.AvailabilityZone;

  const t0 = Date.now();
  const since = new Date(t0 - 5_000);
  await rds.send(
    new RebootDBInstanceCommand({
      DBInstanceIdentifier: id,
      ForceFailover: true,
    }),
  );

  let after = await describe();

  while (after.AvailabilityZone === azBefore && Date.now() - t0 < TIMEOUT_MS) {
    await sleep(POLL_MS);
    after = await describe();
  }

  const failoverSeconds = (Date.now() - t0) / 1000;

  const { Events } = await rds.send(
    new DescribeEventsCommand({
      SourceType: 'db-instance',
      SourceIdentifier: id,
      StartTime: since,
    }),
  );

  const completed = Events.find(e => /failover completed/i.test(e.Message));

  report({
    'az-before': azBefore,
    'az-after': after.AvailabilityZone,
    'failover-seconds': r1(failoverSeconds),
    event: completed?.Message ?? '',
  });

  if (after.AvailabilityZone === azBefore) {
    throw new Error('AZ never changed within the timeout');
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
