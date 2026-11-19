// Stage 5, demo:alb — hits the real ALB, reads the Lambda target's health
// from describe-target-health, then proves the health check actually
// removes it from rotation: flips HEALTHY=false on the target Lambda (the
// same env var demo/components/load-balancer.ts's inline handler checks)
// and waits for target-health to report unhealthy.
//
// Output contract (grader-parsed, one key=number/string per line):
//   alb-dns, http-code, target-state, alb-public-ipv4, drain-seconds
import {
  DescribeNetworkInterfacesCommand,
  EC2Client,
} from '@aws-sdk/client-ec2';
import {
  DescribeTargetHealthCommand,
  ElasticLoadBalancingV2Client,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import {
  LambdaClient,
  UpdateFunctionConfigurationCommand,
} from '@aws-sdk/client-lambda';

import {
  DEMO_DIR,
  pulumiOutput,
  r1,
  realAwsGate,
  report,
  sleep,
} from './utils.mjs';

const POLL_MS = 5_000;
const TIMEOUT_MS = 5 * 60_000;

async function httpCode(url) {
  try {
    return (await fetch(url)).status;
  } catch {
    return 0;
  }
}

async function main() {
  realAwsGate('demo:alb');

  const elbv2 = new ElasticLoadBalancingV2Client({});
  const lambda = new LambdaClient({});
  const ec2 = new EC2Client({});

  const dns = pulumiOutput(DEMO_DIR, 'albDns');
  const targetGroupArn = pulumiOutput(DEMO_DIR, 'targetGroupArn');
  const functionName = pulumiOutput(DEMO_DIR, 'targetFunctionName');

  const targetState = async () =>
    (
      await elbv2.send(
        new DescribeTargetHealthCommand({ TargetGroupArn: targetGroupArn }),
      )
    ).TargetHealthDescriptions[0]?.TargetHealth?.State ?? 'none';

  const http = await httpCode(`http://${dns}/`);
  const stateBefore = await targetState();

  // ALB ENIs are tagged with the load balancer's name in their description
  // ("ELB app/<name>/<id>") — not on the DNS name's trailing id suffix.
  const albName = dns.split('.')[0].replace(/-\d+$/, '');
  const { NetworkInterfaces } = await ec2.send(
    new DescribeNetworkInterfacesCommand({
      Filters: [{ Name: 'description', Values: [`ELB app/${albName}/*`] }],
    }),
  );
  const publicIpv4Count = NetworkInterfaces.filter(
    eni => eni.Association?.PublicIp,
  ).length;

  const t0 = Date.now();
  await lambda.send(
    new UpdateFunctionConfigurationCommand({
      FunctionName: functionName,
      Environment: { Variables: { HEALTHY: 'false' } },
    }),
  );
  let state = await targetState();

  while (state !== 'unhealthy' && Date.now() - t0 < TIMEOUT_MS) {
    await sleep(POLL_MS);
    state = await targetState();
  }

  const drainSeconds = (Date.now() - t0) / 1000;

  await lambda.send(
    new UpdateFunctionConfigurationCommand({
      FunctionName: functionName,
      Environment: { Variables: { HEALTHY: 'true' } },
    }),
  );

  report({
    'alb-dns': dns,
    'http-code': http,
    'target-state': stateBefore,
    'alb-public-ipv4': publicIpv4Count,
    'drain-seconds': r1(drainSeconds),
  });

  if (state !== 'unhealthy') {
    throw new Error('target never left rotation within the timeout');
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
