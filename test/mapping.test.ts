import assert from 'node:assert/strict';
import { test } from 'node:test';

import { costGate, planMonthlyUsd } from '../src/mapping.ts';

// Same shape `pulumi preview --json` emits for infra/'s Deployment.
const plan = {
  steps: [
    {
      op: 'create',
      newState: {
        type: 'kubernetes:apps/v1:Deployment',
        inputs: {
          spec: {
            replicas: 2,
            template: {
              spec: {
                containers: [
                  { resources: { requests: { cpu: '100m', memory: '48Mi' } } },
                ],
              },
            },
          },
        },
      },
    },
    { op: 'create', newState: { type: 'kubernetes:core/v1:Namespace' } },
    { op: 'delete' },
  ],
};

test('prices Deployment requests, ignores everything else', () => {
  // 2 × (0.1 × 0.04656 + 48/1024 × 0.00511) × 730 = 7.147…
  assert.equal(planMonthlyUsd(plan), 7.15);
});

test('same plan, different budget, different verdict', () => {
  const usd = planMonthlyUsd(plan);

  assert.equal(costGate(usd, 0), 'fail');
  assert.equal(costGate(usd, 999999), 'pass');
});
