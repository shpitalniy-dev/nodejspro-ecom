import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

export interface LoadBalancerArgs {
  readonly publicSubnetIds: pulumi.Input<pulumi.Input<string>[]>;
  readonly edgeSgId: pulumi.Input<string>;
}

// A tiny inline handler, not a packaged app: /health flips to 503 when the
// HEALTHY env var is set to "false" — that's how demo:alb (stage 5) proves
// the target group pulls an unhealthy target out of rotation, the same idea
// as the readiness-probe demos from #28, just driven by ALB health checks
// instead of kubelet.
const HEALTH_CHECK_HANDLER = `
exports.handler = async (event) => {
  const sick = process.env.HEALTHY === 'false';
  const code = event.path === '/health' && sick ? 503 : 200;
  return {
    statusCode: code,
    statusDescription: code + ' OK',
    isBase64Encoded: false,
    headers: { 'content-type': 'text/plain' },
    body: code === 200 ? 'ok\\n' : 'draining\\n',
  };
};
`;

// Item 7: internet-facing ALB in the public subnets, target group pointed at
// a Lambda instead of an EC2 instance — EC2 would add both an hourly line
// and another billed public IPv4 the assignment explicitly warns about.
export class LoadBalancer extends pulumi.ComponentResource {
  readonly dnsName: pulumi.Output<string>;
  readonly targetGroupArn: pulumi.Output<string>;
  readonly targetFunctionName: pulumi.Output<string>;

  constructor(
    name: string,
    args: LoadBalancerArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('hw31:demo:LoadBalancer', name, {}, opts);
    const parent = { parent: this };

    const targetRole = new aws.iam.Role(
      `${name}-target-role`,
      {
        assumeRolePolicy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { Service: 'lambda.amazonaws.com' },
              Action: 'sts:AssumeRole',
            },
          ],
        }),
      },
      parent,
    );
    new aws.iam.RolePolicyAttachment(
      `${name}-target-logs`,
      {
        role: targetRole.name,
        policyArn:
          'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
      },
      parent,
    );

    const fn = new aws.lambda.Function(
      `${name}-target`,
      {
        runtime: 'nodejs22.x',
        handler: 'index.handler',
        role: targetRole.arn,
        code: new pulumi.asset.AssetArchive({
          'index.js': new pulumi.asset.StringAsset(HEALTH_CHECK_HANDLER),
        }),
        environment: { variables: { HEALTHY: 'true' } },
        timeout: 5,
        memorySize: 128,
      },
      parent,
    );

    const alb = new aws.lb.LoadBalancer(
      `${name}-alb`,
      {
        loadBalancerType: 'application',
        internal: false,
        subnets: args.publicSubnetIds,
        securityGroups: [args.edgeSgId],
      },
      parent,
    );

    const targetGroup = new aws.lb.TargetGroup(
      `${name}-tg`,
      {
        targetType: 'lambda',
        healthCheck: {
          enabled: true,
          path: '/health',
          matcher: '200',
          interval: 35,
          timeout: 30,
          healthyThreshold: 2,
          unhealthyThreshold: 2,
        },
      },
      parent,
    );

    const invokePermission = new aws.lambda.Permission(
      `${name}-alb-invoke`,
      {
        action: 'lambda:InvokeFunction',
        function: fn.name,
        principal: 'elasticloadbalancing.amazonaws.com',
        sourceArn: targetGroup.arn,
      },
      parent,
    );

    new aws.lb.TargetGroupAttachment(
      `${name}-tg-fn`,
      { targetGroupArn: targetGroup.arn, targetId: fn.arn },
      { ...parent, dependsOn: [invokePermission] },
    );

    new aws.lb.Listener(
      `${name}-http`,
      {
        loadBalancerArn: alb.arn,
        port: 80,
        protocol: 'HTTP',
        defaultActions: [{ type: 'forward', targetGroupArn: targetGroup.arn }],
      },
      parent,
    );

    this.dnsName = alb.dnsName;
    this.targetGroupArn = targetGroup.arn;
    this.targetFunctionName = fn.name;
    this.registerOutputs({
      dnsName: this.dnsName,
      targetGroupArn: this.targetGroupArn,
    });
  }
}
