// Shared primitives for demo/demo-*.mjs — HW #28 criteria 6-9.
//
// ensureDefaultState() exists because none of the demo scripts can assume
// the previous one cleaned up correctly: a crashed run can leave the HPA
// deleted, the Deployment mid-scale, a stray load pod behind, or a hand-
// edited HPA/PDB spec, and the next demo would silently measure against
// that corrupted baseline. It always re-runs `npm run up` rather than
// first checking whether anything looks wrong — Pulumi already diffs the
// full committed spec, so a cheap presence-only check here would still
// miss a drifted *spec* (e.g. someone changed the PDB's minAvailable) on
// a resource that still exists and is settled. `npm run up` is idempotent
// and this project's own one source of truth for "default state," so this
// reuses it instead of hand-maintaining a second, necessarily partial copy
// of it — the same reasoning GitOps controllers (ArgoCD/Flux) use for
// drift correction: reapply the source of truth, don't patch around the
// symptom. The cost (a few seconds per demo run, even when nothing was
// wrong) is a non-issue at this project's scale — a demo invoked by hand
// a handful of times, not a hot loop.
import { spawnSync } from 'node:child_process';

export const NAMESPACE = 'nodejspro-ecom';
export const DEPLOYMENT = 'nodejspro-ecom-api';
export const HPA = 'nodejspro-ecom-api';
export const PDB_NAME = 'nodejspro-ecom-api';
export const LOAD_POD = 'demo-rollout-load';

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });

  return { code: r.status ?? -1, out: (r.stdout ?? '').trim() };
}

export function kubectlJson(args) {
  return JSON.parse(run('kubectl', args).out);
}

export function getHpaManifest() {
  const hpa = kubectlJson(['-n', NAMESPACE, 'get', 'hpa', HPA, '-o', 'json']);

  // Trimmed to exactly what a fresh `kubectl apply -f -` needs — not
  // `status`, `metadata.resourceVersion`/`uid`/`creationTimestamp`, which
  // belong to the object we're about to delete, not the one we're about to
  // create.
  return {
    apiVersion: hpa.apiVersion,
    kind: hpa.kind,
    metadata: { name: hpa.metadata.name, namespace: hpa.metadata.namespace },
    spec: hpa.spec,
  };
}

export function deleteHpa() {
  run('kubectl', ['-n', NAMESPACE, 'delete', 'hpa', HPA, '--wait=true']);
}

export function restoreHpa(manifest) {
  spawnSync('kubectl', ['apply', '-f', '-'], {
    input: JSON.stringify(manifest),
  });
}

export function scaleTo(replicas) {
  run('kubectl', [
    '-n',
    NAMESPACE,
    'scale',
    'deploy',
    DEPLOYMENT,
    `--replicas=${replicas}`,
  ]);
}

// With no `replicas`, waits for internal self-consistency only (whatever
// count it rests at once nothing is adjusting it). With `replicas`, also
// requires that exact count — needed by demo-pdb.mjs, where the test is
// only valid at exactly 2 replicas. "2 consecutive checks" debounce: a
// single lucky instant where the counts happen to agree isn't enough on
// its own — caught live, a single-read version of this previously passed
// mid-transition. Throws, naming the last status seen, rather than
// silently continuing if it never actually settles.
export async function waitForDeploymentSettled({ replicas } = {}) {
  let stableChecks = 0;
  let lastStatus;

  for (let i = 0; i < 90 && stableChecks < 2; i++) {
    const deploy = kubectlJson([
      '-n',
      NAMESPACE,
      'get',
      'deploy',
      DEPLOYMENT,
      '-o',
      'json',
    ]);
    lastStatus = deploy.status;
    const selfConsistent =
      lastStatus.replicas === lastStatus.readyReplicas &&
      lastStatus.replicas === lastStatus.availableReplicas &&
      lastStatus.replicas === lastStatus.updatedReplicas;
    const settled =
      replicas === undefined
        ? selfConsistent
        : selfConsistent && lastStatus.replicas === replicas;

    stableChecks = settled ? stableChecks + 1 : 0;

    if (stableChecks < 2) {
      await sleep(1000);
    }
  }

  if (stableChecks < 2) {
    const target = replicas === undefined ? '' : ` at ${replicas} replicas`;
    throw new Error(
      `Deployment never settled${target} (last status: ${JSON.stringify(lastStatus)})`,
    );
  }
}

// The Deployment settling doesn't mean the PDB *controller* has caught up
// to it — it's a separate reconcile loop with its own lag, watching pods
// independently of the Deployment's own status fields. Caught live: right
// after scaling 4 -> 2, the PDB was still computing its budget against the
// old 4-pod state (disruptionsAllowed=3, stale `expectedPods`), so an
// eviction that should have been rejected was wrongly admitted. Can't
// delete the PDB to sidestep it the way the HPA is deleted elsewhere in
// this file — it's literally the thing under test in demo-pdb.mjs — so
// this waits for its own status to actually reflect the new reality
// instead of guessing a margin.
export async function waitForPdbSynced(replicas, minAvailable) {
  const expectedDisruptionsAllowed = replicas - minAvailable;
  let stableChecks = 0;
  let lastStatus;

  for (let i = 0; i < 90 && stableChecks < 2; i++) {
    const pdb = kubectlJson([
      '-n',
      NAMESPACE,
      'get',
      'pdb',
      PDB_NAME,
      '-o',
      'json',
    ]);
    lastStatus = pdb.status;
    const synced =
      lastStatus.expectedPods === replicas &&
      lastStatus.currentHealthy === replicas &&
      lastStatus.disruptionsAllowed === expectedDisruptionsAllowed;

    stableChecks = synced ? stableChecks + 1 : 0;

    if (stableChecks < 2) {
      await sleep(1000);
    }
  }

  if (stableChecks < 2) {
    throw new Error(
      `PDB never synced to ${replicas} replicas (last status: ${JSON.stringify(lastStatus)})`,
    );
  }
}

// Reconciles the cluster to the committed baseline before a demo's own
// test logic runs — see the module comment above for why this always
// re-runs `npm run up` rather than checking first. Harmless if a stray
// load pod from a crashed demo-rollout.mjs run isn't actually there.
export async function ensureDefaultState() {
  run('kubectl', ['-n', NAMESPACE, 'delete', 'pod', LOAD_POD, '--wait=false']);

  const up = spawnSync('npm', ['run', 'up'], { stdio: 'inherit' });

  if (up.status !== 0) {
    throw new Error(
      `npm run up failed while resetting cluster state (exit ${up.status})`,
    );
  }

  await waitForDeploymentSettled();

  const replicas = kubectlJson([
    '-n',
    NAMESPACE,
    'get',
    'deploy',
    DEPLOYMENT,
    '-o',
    'json',
  ]).status.replicas;

  const minAvailable = kubectlJson([
    '-n',
    NAMESPACE,
    'get',
    'pdb',
    PDB_NAME,
    '-o',
    'json',
  ]).spec.minAvailable;

  await waitForPdbSynced(replicas, minAvailable);
}
