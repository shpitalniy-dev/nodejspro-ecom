import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

export interface BudgetArgs {
  readonly email: string;
}

// Item 2: budget is the first resource, before VPC/IAM/anything else. Alerts
// fire on actual spend only — the forecast-based notification type needs
// roughly five weeks of account history before it can ever trigger, so on a
// brand-new account it would silently never fire.
export class Budget extends pulumi.ComponentResource {
  readonly budget: aws.budgets.Budget;

  constructor(
    name: string,
    args: BudgetArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('hw31:base:Budget', name, {}, opts);

    this.budget = new aws.budgets.Budget(
      `${name}-budget`,
      {
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        limitAmount: '5',
        limitUnit: 'USD',
        notifications: [
          {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 20,
            thresholdType: 'PERCENTAGE',
            subscriberEmailAddresses: [args.email],
          },
        ],
      },
      { parent: this },
    );

    this.registerOutputs({});
  }
}
