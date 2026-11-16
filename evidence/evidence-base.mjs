// evidence:base — real AWS reads for the base stack: VPC, subnets, route
// tables, security groups, and the Project+Stack tag, plus a verbatim
// `pulumi stack export`. Written to evidence/base.txt and
// evidence/base-state.json, per the assignment's "Контракт доказів".
import {
  DescribeRouteTablesCommand,
  DescribeSecurityGroupsCommand,
  DescribeSubnetsCommand,
  EC2Client,
} from '@aws-sdk/client-ec2';
import {
  GetResourcesCommand,
  ResourceGroupsTaggingAPIClient,
} from '@aws-sdk/client-resource-groups-tagging-api';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

import { BASE_DIR, pulumiOutput, realAwsGate, STACK } from '../demo/utils.mjs';

async function main() {
  realAwsGate('evidence:base');

  const ec2 = new EC2Client({});
  const tagging = new ResourceGroupsTaggingAPIClient({});

  const vpcId = pulumiOutput(BASE_DIR, 'vpcId');
  const publicSubnetIds = JSON.parse(pulumiOutput(BASE_DIR, 'publicSubnetIds'));
  const privateSubnetIds = JSON.parse(
    pulumiOutput(BASE_DIR, 'privateSubnetIds'),
  );

  const { Subnets } = await ec2.send(
    new DescribeSubnetsCommand({
      SubnetIds: [...publicSubnetIds, ...privateSubnetIds],
    }),
  );
  const subnetAzs = new Set(Subnets.map(s => s.AvailabilityZone)).size;

  // The one route that must NOT exist: a private subnet's route table with
  // a path to the internet. Filtering by association, not by name, so a
  // private subnet wrongly left on the public route table would be caught.
  const { RouteTables } = await ec2.send(
    new DescribeRouteTablesCommand({
      Filters: [{ Name: 'association.subnet-id', Values: privateSubnetIds }],
    }),
  );
  const privateDefaultRoutes = RouteTables.flatMap(
    rt => rt.Routes ?? [],
  ).filter(r => r.DestinationCidrBlock === '0.0.0.0/0').length;

  const { SecurityGroups } = await ec2.send(
    new DescribeSecurityGroupsCommand({
      Filters: [{ Name: 'vpc-id', Values: [vpcId] }],
    }),
  );

  const { ResourceTagMappingList } = await tagging.send(
    new GetResourcesCommand({
      TagFilters: [
        { Key: 'Project', Values: ['nodejs-pro-hw31'] },
        { Key: 'Stack', Values: ['base'] },
      ],
    }),
  );

  const lines = {
    'vpc-id': vpcId,
    'public-subnets': publicSubnetIds.length,
    'private-subnets': privateSubnetIds.length,
    'subnet-azs': subnetAzs,
    'private-default-route': privateDefaultRoutes,
    'security-groups': SecurityGroups.length,
    'tagged-resources': ResourceTagMappingList.length,
  };

  mkdirSync('evidence', { recursive: true });
  const text = Object.entries(lines)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  writeFileSync('evidence/base.txt', `${text}\n`);
  console.log(text);

  const exported = spawnSync(
    'pulumi',
    ['stack', 'export', '--stack', STACK, '--cwd', BASE_DIR],
    { encoding: 'utf8' },
  );

  if (exported.status !== 0) {
    throw new Error(`pulumi stack export failed: ${exported.stderr}`);
  }

  writeFileSync('evidence/base-state.json', exported.stdout);
  console.log('wrote evidence/base-state.json');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
