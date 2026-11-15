import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

export interface DatabaseArgs {
  readonly privateSubnetIds: pulumi.Input<pulumi.Input<string>[]>;
  readonly appSgId: pulumi.Input<string>;
  readonly dbPassword: pulumi.Input<string>;
}

// Item 6: Multi-AZ instance deployment (not a Multi-AZ DB cluster — that
// needs db.c6gd/m5d/m6gd classes and costs ~6.4x as much). db.t4g.micro,
// gp3 20GiB, encrypted, 1-day backup retention (free up to 100% of storage
// used). No Performance Insights or Enhanced Monitoring: not graded, not free.
export class Database extends pulumi.ComponentResource {
  readonly instance: aws.rds.Instance;

  constructor(
    name: string,
    args: DatabaseArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('hw31:demo:Database', name, {}, opts);
    const parent = { parent: this };

    const subnetGroup = new aws.rds.SubnetGroup(
      `${name}-db-subnets`,
      // Private subnets only — the database must stay unreachable from the internet.
      { subnetIds: args.privateSubnetIds },
      parent,
    );

    this.instance = new aws.rds.Instance(
      `${name}-db`,
      {
        identifier: `${name}-db`,
        engine: 'postgres',
        engineVersion: '16',
        instanceClass: 'db.t4g.micro',
        allocatedStorage: 20,
        storageType: 'gp3',
        storageEncrypted: true,
        multiAz: true,
        dbSubnetGroupName: subnetGroup.name,
        vpcSecurityGroupIds: [args.appSgId],
        publiclyAccessible: false,
        dbName: 'app',
        username: 'app',
        password: args.dbPassword,
        backupRetentionPeriod: 1,
        // Belt-and-suspenders with the registerResourceTransform in index.ts
        // — either one alone is enough for `destroy` to not get stuck here.
        deletionProtection: false,
        skipFinalSnapshot: true,
        applyImmediately: true,
      },
      parent,
    );

    this.registerOutputs({ instanceId: this.instance.id });
  }
}
