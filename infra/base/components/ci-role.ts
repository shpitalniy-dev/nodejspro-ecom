import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

export interface CiRoleArgs {
  // "owner/repo" — narrows the trust policy's `sub` condition to this repo only.
  readonly githubRepo: string;
}

// Item 5: lets GitHub Actions assume this role via OIDC — no long-lived AWS
// keys stored anywhere in CI. The role only exists to run `pulumi destroy`
// on the demo stack, so its permissions are scoped to deleting (and
// describing, for the teardown workflow's own six-zero checks) exactly what
// that stack is planned to create.
export class CiRole extends pulumi.ComponentResource {
  readonly roleArn: pulumi.Output<string>;

  constructor(
    name: string,
    args: CiRoleArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('hw31:base:CiRole', name, {}, opts);
    const parent = { parent: this };

    const oidc = new aws.iam.OpenIdConnectProvider(
      `${name}-gh-oidc`,
      {
        url: 'https://token.actions.githubusercontent.com',
        clientIdLists: ['sts.amazonaws.com'],
      },
      parent,
    );

    const [owner, repo] = args.githubRepo.split('/');
    // Two subject patterns, not one: GitHub is mid-rollout of an immutable-ID
    // claim format (`repo:owner@<id>/name@<id>:...`); older repos still use
    // the plain `repo:owner/name:...` form. Both are allowed so this trust
    // policy doesn't silently break depending on which format this repo gets.
    const subjects = [
      `repo:${args.githubRepo}:*`,
      `repo:${owner}@*/${repo}@*:*`,
    ];

    const trustPolicy = oidc.arn.apply(arn =>
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { Federated: arn },
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: {
              StringEquals: {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
              },
              StringLike: {
                'token.actions.githubusercontent.com:sub': subjects,
              },
            },
          },
        ],
      }),
    );

    const role = new aws.iam.Role(
      `${name}-ci-teardown`,
      { assumeRolePolicy: trustPolicy },
      parent,
    );

    // shortcut: scoped to what the demo stack is PLANNED to create (stage 4,
    // not built yet) — RDS, ALB/target group, NAT+EIP, a Lambda ALB target
    // and its execution role. Revisit this list once stage 4 lands; a demo
    // resource type with no matching Allow here just makes `destroy` fail
    // loudly, not succeed silently, so the risk is one-directional.
    new aws.iam.RolePolicy(
      `${name}-ci-teardown-policy`,
      { role: role.id, policy: JSON.stringify(teardownPolicy()) },
      parent,
    );

    this.roleArn = role.arn;
    this.registerOutputs({ roleArn: this.roleArn });
  }
}

function allow(sid: string, actions: string[]) {
  return { Sid: sid, Effect: 'Allow', Action: actions, Resource: '*' };
}

// Resource: "*" here is deliberate, not lazy: the demo stack's ARNs don't
// exist yet when this role is created, since base is deployed first.
function teardownPolicy() {
  return {
    Version: '2012-10-17',
    Statement: [
      allow('Rds', [
        'rds:DeleteDBInstance',
        'rds:DescribeDBInstances',
        'rds:DeleteDBSubnetGroup',
        'rds:DescribeDBSubnetGroups',
        'rds:ListTagsForResource',
      ]),
      allow('Elb', [
        'elasticloadbalancing:DeleteLoadBalancer',
        'elasticloadbalancing:DeleteListener',
        'elasticloadbalancing:DeleteTargetGroup',
        'elasticloadbalancing:DeregisterTargets',
        'elasticloadbalancing:DescribeLoadBalancers',
        'elasticloadbalancing:DescribeListeners',
        'elasticloadbalancing:DescribeTargetGroups',
        'elasticloadbalancing:DescribeTargetHealth',
      ]),
      allow('Nat', [
        'ec2:DeleteNatGateway',
        'ec2:DescribeNatGateways',
        'ec2:ReleaseAddress',
        'ec2:DisassociateAddress',
        'ec2:DescribeAddresses',
      ]),
      allow('LambdaTarget', [
        'lambda:DeleteFunction',
        'lambda:GetFunction',
        'lambda:RemovePermission',
        'lambda:GetPolicy',
      ]),
      allow('LambdaExecutionRole', [
        'iam:DeleteRole',
        'iam:GetRole',
        'iam:DetachRolePolicy',
        'iam:ListAttachedRolePolicies',
        'iam:ListRolePolicies',
        'iam:DeleteRolePolicy',
      ]),
      // The teardown workflow's own "tagged-resources-left" check: one
      // tag:GetResources query finds anything left standing, in either region.
      allow('Audit', ['tag:GetResources', 'sts:GetCallerIdentity']),
    ],
  };
}
