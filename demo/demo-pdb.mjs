// HW #28, criterion 8 — PodDisruptionBudget: proves voluntary eviction
// is blocked when it would violate minAvailable, via the real Eviction
// API (`POST .../pods/<pod>/eviction`), not `kubectl delete pod` — a
// plain delete bypasses the PDB entirely, so it can't demonstrate this
// at all. Every value below is read live from the cluster or is a real
// HTTP response, never guessed.
//
// Output contract (grader-parsed, one `key=number` per line):
//   healthy, minAvailable, evict-1, evict-2
import { spawn, spawnSync } from 'node:child_process';

const NAMESPACE = 'nodejspro-ecom';
const DEPLOYMENT = 'nodejspro-ecom-api';
const PDB_NAME = 'nodejspro-ecom-api';
const HPA = 'nodejspro-ecom-api';
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

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });

  return { code: r.status ?? -1, out: (r.stdout ?? '').trim() };
}

function kubectlJson(args) {
  return JSON.parse(run('kubectl', args).out);
}

function getHpaManifest() {
  const hpa = kubectlJson(['-n', NAMESPACE, 'get', 'hpa', HPA, '-o', 'json']);

  return {
    apiVersion: hpa.apiVersion,
    kind: hpa.kind,
    metadata: { name: hpa.metadata.name, namespace: hpa.metadata.namespace },
    spec: hpa.spec,
  };
}

function deleteHpa() {
  run('kubectl', ['-n', NAMESPACE, 'delete', 'hpa', HPA, '--wait=true']);
}

function restoreHpa(manifest) {
  spawnSync('kubectl', ['apply', '-f', '-'], {
    input: JSON.stringify(manifest),
  });
}

function scaleTo(replicas) {
  run('kubectl', [
    '-n',
    NAMESPACE,
    'scale',
    'deploy',
    DEPLOYMENT,
    `--replicas=${replicas}`,
  ]);
}

// Unlike demo-rollout.mjs's waitForDeploymentSettled, this test needs
// *exactly* `replicas` (minAvailable:1 only blocks the second eviction
// when replicas - minAvailable === 1), not just internal self-
// consistency. Throws, naming the last status seen, rather than
// silently continuing if it never actually settles there — evicting
// against the wrong replica count would prove nothing.
async function waitForReplicas(replicas) {
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
    const settled =
      lastStatus.replicas === replicas &&
      lastStatus.readyReplicas === replicas &&
      lastStatus.availableReplicas === replicas &&
      lastStatus.updatedReplicas === replicas;

    stableChecks = settled ? stableChecks + 1 : 0;

    if (stableChecks < 2) {
      await sleep(1000);
    }
  }

  if (stableChecks < 2) {
    throw new Error(
      `Deployment never settled at ${replicas} replicas (last status: ${JSON.stringify(lastStatus)})`,
    );
  }
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
await waitForReplicas(BASELINE_REPLICAS);

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
