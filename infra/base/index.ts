// HW #31 — composition root. Creates nothing itself; each concern lives in
// components/ and grows independently as later stages land.
import * as pulumi from '@pulumi/pulumi';

import { Budget } from './components/budget';
import { CiRole } from './components/ci-role';
import { Network } from './components/network';
import { SecurityGroups } from './components/security-groups';

const BUDGET_EMAIL =
  process.env.HW31_BUDGET_EMAIL || 'placeholder@example.invalid';

new Budget('hw31', { email: BUDGET_EMAIL });

// AZs come from stack config, not aws.getAvailabilityZones() — so `pulumi
// preview` never needs network access to type-check this program.
const config = new pulumi.Config();
const azs = config.requireObject<[string, string]>('azs');
const cidr = config.get('vpcCidr') ?? '10.31.0.0/16';

const network = new Network('hw31', { cidr, azs });
const securityGroups = new SecurityGroups('hw31', {
  vpcId: network.vpcId,
  vpcCidr: network.vpcCidr,
});

const ciRole = new CiRole('hw31', {
  githubRepo: 'shpitalniy-dev/nodejspro-ecom',
});

// infra/demo reads these via a StackReference — it never recreates the VPC,
// subnets, or security groups base already made.
export const vpcId = network.vpcId;
export const publicSubnetIds = network.publicSubnetIds;
export const privateSubnetIds = network.privateSubnetIds;
export const edgeSgId = securityGroups.edge.id;
export const appSgId = securityGroups.app.id;
export const ciRoleArn = ciRole.roleArn;
