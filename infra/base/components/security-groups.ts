import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

export interface SecurityGroupsArgs {
  readonly vpcId: pulumi.Input<string>;
  readonly vpcCidr: string;
}

// Item 3: minimum two security groups, every open port explained inline.
// "edge" fronts the ALB (built in the demo stack); "app" fronts RDS and
// trusts only the edge SG — never the internet, never the rest of the VPC.
export class SecurityGroups extends pulumi.ComponentResource {
  readonly edge: aws.ec2.SecurityGroup;
  readonly app: aws.ec2.SecurityGroup;

  constructor(
    name: string,
    args: SecurityGroupsArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('hw31:base:SecurityGroups', name, {}, opts);
    const parent = { parent: this };

    this.edge = new aws.ec2.SecurityGroup(
      `${name}-sg-edge`,
      {
        vpcId: args.vpcId,
        description: 'ALB: HTTP from the internet',
        ingress: [
          // The one public entry point. No HTTPS: no domain or certificate
          // for this homework.
          {
            protocol: 'tcp',
            fromPort: 80,
            toPort: 80,
            cidrBlocks: ['0.0.0.0/0'],
            description: 'HTTP to ALB',
          },
        ],
        egress: [
          // The ALB only ever needs to reach its own target inside the VPC.
          {
            protocol: '-1',
            fromPort: 0,
            toPort: 0,
            cidrBlocks: [args.vpcCidr],
            description: 'to targets inside VPC',
          },
        ],
      },
      parent,
    );

    this.app = new aws.ec2.SecurityGroup(
      `${name}-sg-app`,
      {
        vpcId: args.vpcId,
        description: 'RDS: Postgres only from the edge SG',
        ingress: [
          // Nothing from the internet and nothing from the rest of the VPC —
          // only from the edge SG, by reference, not by CIDR.
          {
            protocol: 'tcp',
            fromPort: 5432,
            toPort: 5432,
            securityGroups: [this.edge.id],
            description: 'Postgres from edge',
          },
        ],
        egress: [], // the database never initiates outbound traffic
      },
      parent,
    );

    this.registerOutputs({});
  }
}
