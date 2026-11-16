// evidence:iam — real AWS reads for the CI OIDC role: trust policy and
// permission policy decoded into evidence/iam.json (criterion B1 parses
// this as plain JSON, so both are decoded, never left URL-encoded), and a
// real positive + negative simulate-principal-policy check into
// evidence/iam.txt (criterion B2 — a green test alone never proves a deny).
import {
  GetRoleCommand,
  GetRolePolicyCommand,
  IAMClient,
  ListRolePoliciesCommand,
  SimulatePrincipalPolicyCommand,
} from '@aws-sdk/client-iam';
import { mkdirSync, writeFileSync } from 'node:fs';

import { BASE_DIR, pulumiOutput, realAwsGate } from '../demo/utils.mjs';

function decodePolicy(doc) {
  try {
    return JSON.parse(doc);
  } catch {
    return JSON.parse(decodeURIComponent(doc));
  }
}

async function simulate(iam, roleArn, actionNames) {
  const { EvaluationResults } = await iam.send(
    new SimulatePrincipalPolicyCommand({
      PolicySourceArn: roleArn,
      ActionNames: actionNames,
    }),
  );

  return EvaluationResults[0].EvalDecision;
}

async function main() {
  realAwsGate('evidence:iam');

  const iam = new IAMClient({});
  const roleArn = pulumiOutput(BASE_DIR, 'ciRoleArn');
  const roleName = roleArn.split('/').pop();

  const { Role } = await iam.send(new GetRoleCommand({ RoleName: roleName }));
  const trustPolicy = decodePolicy(Role.AssumeRolePolicyDocument);

  const { PolicyNames } = await iam.send(
    new ListRolePoliciesCommand({ RoleName: roleName }),
  );
  const { PolicyDocument } = await iam.send(
    new GetRolePolicyCommand({
      RoleName: roleName,
      PolicyName: PolicyNames[0],
    }),
  );
  const permissionPolicy = decodePolicy(PolicyDocument);

  mkdirSync('evidence', { recursive: true });
  writeFileSync(
    'evidence/iam.json',
    JSON.stringify({ trustPolicy, permissionPolicy }, null, 2),
  );
  console.log('wrote evidence/iam.json');

  // rds:DescribeDBInstances is one of the teardown policy's own actions;
  // s3:DeleteBucket is in no statement at all — the two sides of B2.
  const simAllowed = await simulate(iam, roleArn, ['rds:DescribeDBInstances']);
  const simDenied = await simulate(iam, roleArn, ['s3:DeleteBucket']);

  const lines = { 'sim-allowed': simAllowed, 'sim-denied': simDenied };
  const text = Object.entries(lines)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  writeFileSync('evidence/iam.txt', `${text}\n`);
  console.log(text);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
