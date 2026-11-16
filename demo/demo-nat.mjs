// Stage 5, demo:nat — flips demo/components/nat.ts's hw31:withNat flag on
// then immediately off again, so the NAT Gateway it creates lives for
// minutes, not hours. AWS bills every partial NAT Gateway-hour as a full
// hour, so a short life should still show nat-billed-hours=1 — the point of
// this demo is proving that ceiling, not the NAT itself being useful.
//
// Output contract (grader-parsed, one key=number per line):
//   nat-minutes, nat-billed-hours, nat-up-seconds, nat-down-seconds
import { DescribeNatGatewaysCommand, EC2Client } from '@aws-sdk/client-ec2';

import {
  DEMO_DIR,
  pulumiConfigSet,
  pulumiOutput,
  pulumiUp,
  r1,
  realAwsGate,
  report,
} from './utils.mjs';

async function main() {
  realAwsGate('demo:nat');

  pulumiConfigSet(DEMO_DIR, 'hw31:withNat', 'true');
  const upSeconds = pulumiUp(DEMO_DIR);
  const natId = pulumiOutput(DEMO_DIR, 'natGatewayId');

  pulumiConfigSet(DEMO_DIR, 'hw31:withNat', 'false');
  const downSeconds = pulumiUp(DEMO_DIR);

  const ec2 = new EC2Client({});
  const { NatGateways } = await ec2.send(
    new DescribeNatGatewaysCommand({ NatGatewayIds: [natId] }),
  );
  const gateway = NatGateways[0];
  const minutes =
    (new Date(gateway.DeleteTime) - new Date(gateway.CreateTime)) / 60_000;
  const billedHours = Math.ceil(minutes / 60);

  report({
    'nat-minutes': r1(minutes),
    'nat-billed-hours': billedHours,
    'nat-up-seconds': r1(upSeconds),
    'nat-down-seconds': r1(downSeconds),
  });

  if (gateway.State !== 'deleted')
    throw new Error(`NAT gateway state is ${gateway.State}, not deleted`);
  if (minutes >= 60)
    throw new Error(
      'NAT gateway lived an hour or more — demo no longer proves the ceiling',
    );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
