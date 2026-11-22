import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { costGate, planMonthlyUsd } from '../src/mapping.ts';

// The Deployment and HPA steps of a real `pulumi preview --json` from
// pr.yml (run 44742031108's pipeline-evidence/plan.json), unedited.
type Plan = Required<Parameters<typeof planMonthlyUsd>[0]>;

const realPlan = (): Plan =>
  JSON.parse(readFileSync('test/fixtures/plan.json', 'utf8'));
const DEPLOYMENT = 'kubernetes:apps/v1:Deployment';
const HPA = 'kubernetes:autoscaling/v2:HorizontalPodAutoscaler';

const specOf = (plan: Plan, type: string) => {
  const spec = plan.steps.find(s => s.newState?.type === type)?.newState?.inputs
    ?.spec;

  assert.ok(spec, `no ${type} in the fixture`);

  return spec;
};

test('real plan: Deployment requests × HPA minReplicas', () => {
  // 2 × (0.1 × 0.04656 + 48/1024 × 0.00511) × 730 = 7.147…
  assert.equal(planMonthlyUsd(realPlan()), 7.15);
});

test('replicas: HPA first, then the Deployment, then 1', () => {
  const plan = realPlan();

  specOf(plan, DEPLOYMENT).replicas = 4;
  assert.equal(planMonthlyUsd(plan), 7.15); // HPA (2) overrides replicas (4)

  specOf(plan, HPA).scaleTargetRef = { kind: 'Deployment', name: 'other' };
  assert.equal(planMonthlyUsd(plan), 14.29); // foreign HPA → replicas (4)

  delete specOf(plan, DEPLOYMENT).replicas;
  assert.equal(planMonthlyUsd(plan), 3.57); // neither → 1
});

test('same plan, different budget, different verdict', () => {
  const usd = planMonthlyUsd(realPlan());

  assert.equal(costGate(usd, 0), 'fail');
  assert.equal(costGate(usd, 999999), 'pass');
});
