// HW #28, criterion 8 — PodDisruptionBudget: proves voluntary eviction
// is blocked when it would violate minAvailable, via the real Eviction
// API (`POST .../pods/<pod>/eviction`), not `kubectl delete pod` — a
// plain delete bypasses the PDB entirely, so it can't demonstrate this
// at all. Every value below is read live from the cluster or is a real
// HTTP response, never guessed.
//
// Output contract (grader-parsed, one `key=number` per line):
//   healthy, minAvailable, evict-1, evict-2
import { spawn } from 'node:child_process';

import {
  deleteHpa,
  ensureDefaultState,
  getHpaManifest,
  kubectlJson,
  NAMESPACE,
  PDB_NAME,
  restoreHpa,
  run,
  scaleTo,
  waitForDeploymentSettled,
  waitForPdbSynced,
} from './utils.mjs';

// This demo only makes sense at exactly 2 replicas: minAvailable:1
// means evicting one pod consumes the *entire* budget only when
// replicas - minAvailable === 1. At 3+ replicas (e.g. the HPA mid
// scale-up from unrelated load), evicting two would still leave
// enough healthy pods and evict-2 would wrongly succeed too.
const BASELINE_REPLICAS = 2;
const PROXY_PORT = 8081;
const PROXY_URL = `http://127.0.0.1:${PROXY_PORT}`;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getPodNames() {
  const r = run('kubectl', [
    '-n',
    NAMESPACE,
    'get',
    'pods',
    '-l',
    'app=nodejspro-ecom-api',
    '-o',
    'jsonpath={.items[*].metadata.name}',
  ]);

  const names = r.out.split(/\s+/).filter(Boolean);

  if (names.length < 2) {
    throw new Error(`expected 2 pods, found ${names.length}: ${r.out}`);
  }

  return names;
}

function getPdbStatus() {
  const healthy = run('kubectl', [
    '-n',
    NAMESPACE,
    'get',
    'pdb',
    PDB_NAME,
    '-o',
    'jsonpath={.status.currentHealthy}',
  ]).out;

  const minAvailable = run('kubectl', [
    '-n',
    NAMESPACE,
    'get',
    'pdb',
    PDB_NAME,
    '-o',
    'jsonpath={.spec.minAvailable}',
  ]).out;

  return { healthy, minAvailable };
}

async function waitForProxy() {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${PROXY_URL}/healthz`, { signal: AbortSignal.timeout(500) });

      return;
    } catch {
      await sleep(100);
    }
  }

  throw new Error('kubectl proxy never came up');
}

async function evict(podName) {
  const res = await fetch(
    `${PROXY_URL}/api/v1/namespaces/${NAMESPACE}/pods/${podName}/eviction`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiVersion: 'policy/v1',
        kind: 'Eviction',
        metadata: { name: podName, namespace: NAMESPACE },
      }),
    },
  );

  return res.status;
}

await ensureDefaultState();

console.log(`pausing HPA, scaling to ${BASELINE_REPLICAS} replicas`);

// Manifest captured and the exit-safety-net registered *before*
// anything is deleted — same reasoning as demo-rollout.mjs: if the
// settle-check below throws and the net were only registered after a
// successful pause, the HPA would already be deleted with nothing left
// to restore it. Belt-and-suspenders beyond that: a crash the normal
// try/finally never reaches still needs this — already happened once.
const hpaManifest = getHpaManifest();
let hpaRestored = false;

function restoreHpaOnce() {
  if (hpaRestored) return;
  hpaRestored = true;
  restoreHpa(hpaManifest);
}

process.on('exit', restoreHpaOnce);

deleteHpa();
scaleTo(BASELINE_REPLICAS);
await waitForDeploymentSettled({ replicas: BASELINE_REPLICAS });

const pdbMinAvailable = kubectlJson([
  '-n',
  NAMESPACE,
  'get',
  'pdb',
  PDB_NAME,
  '-o',
  'json',
]).spec.minAvailable;

await waitForPdbSynced(BASELINE_REPLICAS, pdbMinAvailable);

try {
  const [podA, podB] = getPodNames();
  const { healthy, minAvailable } = getPdbStatus();
  const proxy = spawn('kubectl', ['proxy', '--port', String(PROXY_PORT)]);

  try {
    await waitForProxy();

    const evict1 = await evict(podA);
    const evict2 = await evict(podB);

    console.log(`healthy=${healthy}`);
    console.log(`minAvailable=${minAvailable}`);
    console.log(`evict-1=${evict1}`);
    console.log(`evict-2=${evict2}`);
  } finally {
    proxy.kill();
  }
} finally {
  restoreHpaOnce();
}
