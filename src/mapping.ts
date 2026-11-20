// HW #32 gate:cost — turns a `pulumi preview --json` plan into USD/month
// and compares it with COST_BUDGET_USD. Local kind costs nothing, so the
// price is what the same pod requests would cost on AWS Fargate
// eu-central-1, on-demand (AWS Price List API, AmazonECS offer,
// published 2026-11-11; see README ## CI/CD).
// shortcut: ignores Fargate's per-task minimums and rounding, upgrade if
// this ever has to match a real bill.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const USD_PER_VCPU_HOUR = 0.04656;
export const USD_PER_GB_HOUR = 0.00511;
const HOURS_PER_MONTH = 730;

interface Container {
  resources?: { requests?: { cpu?: string; memory?: string } };
}

interface PlanStep {
  op: string;
  newState?: {
    type: string;
    inputs?: {
      spec?: {
        replicas?: number;
        template?: { spec?: { containers?: Container[] } };
      };
    };
  };
}

export function parseCpu(value = '0'): number {
  return value.endsWith('m')
    ? Number(value.slice(0, -1)) / 1000
    : Number(value);
}

const MEMORY_UNITS: Record<string, number> = {
  Ki: 2 ** 10,
  Mi: 2 ** 20,
  Gi: 2 ** 30,
  K: 1e3,
  M: 1e6,
  G: 1e9,
};

export function parseMemoryGb(value = '0'): number {
  const match = /^(\d+(?:\.\d+)?)([KMG]i?)?$/.exec(value);

  if (!match) throw new Error(`unparseable memory request: ${value}`);

  return (Number(match[1]) * (MEMORY_UNITS[match[2] ?? ''] ?? 1)) / 2 ** 30;
}

export function planMonthlyUsd(plan: { steps?: PlanStep[] }): number {
  let total = 0;

  for (const step of plan.steps ?? []) {
    if (
      step.op === 'delete' ||
      step.newState?.type !== 'kubernetes:apps/v1:Deployment'
    )
      continue;

    const spec = step.newState.inputs?.spec;
    const replicas = spec?.replicas ?? 1;

    for (const c of spec?.template?.spec?.containers ?? []) {
      const req = c.resources?.requests ?? {};
      const perHour =
        parseCpu(req.cpu) * USD_PER_VCPU_HOUR +
        parseMemoryGb(req.memory) * USD_PER_GB_HOUR;

      total += replicas * perHour * HOURS_PER_MONTH;
    }
  }

  return Math.round(total * 100) / 100;
}

export function costGate(planUsd: number, budgetUsd: number): 'pass' | 'fail' {
  return planUsd <= budgetUsd ? 'pass' : 'fail';
}

async function main(): Promise<void> {
  const planPath = process.env.PLAN_JSON;
  const budget = Number(process.env.COST_BUDGET_USD);

  if (
    !planPath ||
    process.env.COST_BUDGET_USD === undefined ||
    Number.isNaN(budget)
  ) {
    console.error('PLAN_JSON and a numeric COST_BUDGET_USD are required');
    process.exitCode = 2;

    return;
  }

  const planUsd = planMonthlyUsd(JSON.parse(readFileSync(planPath, 'utf8')));
  const gate = costGate(planUsd, budget);

  console.log(`budget-usd=${budget}`);
  console.log(`plan-usd=${planUsd}`);
  console.log(`gate=${gate}`);
  process.exitCode = gate === 'pass' ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
