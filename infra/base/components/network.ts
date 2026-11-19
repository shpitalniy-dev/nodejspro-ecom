import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

export interface NetworkArgs {
  readonly cidr: string;
  readonly azs: [string, string];
}

// Item 3: 2 public + 2 private subnets across 2 AZs. "Private" is enforced
// by routing, not naming or a tag — the private route table carries no
// 0.0.0.0/0 route at all, only the implicit local one.
export class Network extends pulumi.ComponentResource {
  readonly vpcId: pulumi.Output<string>;
  readonly vpcCidr: string;
  readonly publicSubnetIds: pulumi.Output<string>[];
  readonly privateSubnetIds: pulumi.Output<string>[];

  constructor(
    name: string,
    args: NetworkArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('hw31:base:Network', name, {}, opts);
    const parent = { parent: this };

    const vpc = new aws.ec2.Vpc(
      `${name}-vpc`,
      {
        cidrBlock: args.cidr,
        enableDnsSupport: true,
        enableDnsHostnames: true,
      },
      parent,
    );

    const igw = new aws.ec2.InternetGateway(
      `${name}-igw`,
      { vpcId: vpc.id },
      parent,
    );

    const publicSubnets = args.azs.map(
      (az, i) =>
        new aws.ec2.Subnet(
          `${name}-public-${i}`,
          {
            vpcId: vpc.id,
            availabilityZone: az,
            cidrBlock: `10.31.${i}.0/24`,
            // A public IPv4 costs $0.005/h on its own — only ever assigned
            // deliberately (the ALB/NAT EIP in the demo stack), never by default.
            mapPublicIpOnLaunch: false,
            tags: { Tier: 'public' },
          },
          parent,
        ),
    );

    const privateSubnets = args.azs.map(
      (az, i) =>
        new aws.ec2.Subnet(
          `${name}-private-${i}`,
          {
            vpcId: vpc.id,
            availabilityZone: az,
            cidrBlock: `10.31.${10 + i}.0/24`,
            tags: { Tier: 'private' },
          },
          parent,
        ),
    );

    const publicRt = new aws.ec2.RouteTable(
      `${name}-rt-public`,
      {
        vpcId: vpc.id,
        routes: [{ cidrBlock: '0.0.0.0/0', gatewayId: igw.id }],
        tags: { Tier: 'public' },
      },
      parent,
    );

    // No routes beyond the implicit local one: the database living here has
    // no reason to reach, or be reached from, anything outside the VPC.
    const privateRt = new aws.ec2.RouteTable(
      `${name}-rt-private`,
      { vpcId: vpc.id, routes: [], tags: { Tier: 'private' } },
      parent,
    );

    publicSubnets.forEach(
      (s, i) =>
        new aws.ec2.RouteTableAssociation(
          `${name}-rta-public-${i}`,
          { subnetId: s.id, routeTableId: publicRt.id },
          parent,
        ),
    );

    privateSubnets.forEach(
      (s, i) =>
        new aws.ec2.RouteTableAssociation(
          `${name}-rta-private-${i}`,
          { subnetId: s.id, routeTableId: privateRt.id },
          parent,
        ),
    );

    this.vpcId = vpc.id;
    this.vpcCidr = args.cidr;
    this.publicSubnetIds = publicSubnets.map(s => s.id);
    this.privateSubnetIds = privateSubnets.map(s => s.id);

    this.registerOutputs({
      vpcId: this.vpcId,
      publicSubnetIds: this.publicSubnetIds,
      privateSubnetIds: this.privateSubnetIds,
    });
  }
}
