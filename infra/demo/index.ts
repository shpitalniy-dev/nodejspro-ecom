// HW #31 — composition root for the demo stack. Everything here is hourly-
// billed while it exists; reads infra/base's outputs instead of recreating
// anything base already made.
import * as pulumi from '@pulumi/pulumi';

import { Database } from './components/database';
import { LoadBalancer } from './components/load-balancer';
import { Nat } from './components/nat';

// Item 11: registered before any resource exists, so even a future RDS
// instance added here can't skip this — this transform and the literal
// flags inside Database are redundant with each other on purpose; either
// one alone is enough for `destroy` to not get stuck behind deletion
// protection or a final snapshot that would survive it.
pulumi.runtime.registerResourceTransform(args =>
  args.type === 'aws:rds/instance:Instance'
    ? {
        props: {
          ...args.props,
          deletionProtection: false,
          skipFinalSnapshot: true,
        },
        opts: args.opts,
      }
    : undefined,
);

const org = pulumi.getOrganization();
const base = new pulumi.StackReference(`${org}/nodejspro-ecom-aws-base/dev`);

const privateSubnetIds = base.getOutput('privateSubnetIds');
const publicSubnetIds = base.getOutput('publicSubnetIds');
const edgeSgId = base.getOutput('edgeSgId');
const appSgId = base.getOutput('appSgId');

// shortcut: falls back to a placeholder when HW31_DB_PASSWORD isn't set (CI's
// teardown run skips Infisical) so `destroy` can still evaluate this
// resource; `up:demo` always has the real value.
const dbPassword =
  process.env.HW31_DB_PASSWORD ?? 'placeholder-Not-A-Real-Password-1';

const database = new Database('hw31', {
  privateSubnetIds,
  appSgId,
  dbPassword,
});

const loadBalancer = new LoadBalancer('hw31', { publicSubnetIds, edgeSgId });

const config = new pulumi.Config();
let nat: Nat | undefined;

if (config.getBoolean('withNat')) {
  nat = new Nat('hw31', {
    publicSubnetId: publicSubnetIds.apply((ids: string[]) => ids[0]),
  });
}

export const dbInstanceId = database.instance.id;
export const albDns = loadBalancer.dnsName;
export const targetGroupArn = loadBalancer.targetGroupArn;
export const targetFunctionName = loadBalancer.targetFunctionName;
export const natGatewayId = nat?.natGatewayId;
