import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

export interface NatArgs {
  readonly publicSubnetId: pulumi.Input<string>;
}

// Item 8: only ever instantiated behind hw31:withNat — created and destroyed
// within the same demo:nat run, specifically to measure the gap between how
// long it actually lived and what AWS bills for it (partial hour -> full
// hour). No route from any private subnet points at this on purpose: the
// measurement is the price of the NAT Gateway itself, not giving anything
// real egress through it.
export class Nat extends pulumi.ComponentResource {
  readonly natGatewayId: pulumi.Output<string>;

  constructor(
    name: string,
    args: NatArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('hw31:demo:Nat', name, {}, opts);
    const parent = { parent: this };

    const eip = new aws.ec2.Eip(`${name}-nat-eip`, { domain: 'vpc' }, parent);
    const nat = new aws.ec2.NatGateway(
      `${name}-nat`,
      { allocationId: eip.id, subnetId: args.publicSubnetId },
      parent,
    );

    this.natGatewayId = nat.id;
    this.registerOutputs({ natGatewayId: this.natGatewayId });
  }
}
