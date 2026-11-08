// HW #28 — PodDisruptionBudget: proves voluntary eviction is blocked
// when it would violate minAvailable, via the real Eviction API
// (`POST .../pods/<pod>/eviction`), not `kubectl delete pod` — a plain
// delete bypasses the PDB entirely, so it can't demonstrate this at all.
// Every status below is a real HTTP response from the live cluster.
import { spawn, spawnSync } from 'node:child_process';

const NAMESPACE = 'nodejspro-ecom';
const PROXY_PORT = 8081;
const PROXY_URL = `http://127.0.0.1:${PROXY_PORT}`;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });

  return { code: r.status ?? -1, out: (r.stdout ?? '').trim() };
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

  return { status: res.status, body: await res.text() };
}

const [podA, podB] = getPodNames();
const proxy = spawn('kubectl', ['proxy', '--port', String(PROXY_PORT)]);

try {
  await waitForProxy();

  const resultA = await evict(podA);
  console.log(`pod-a=${podA}`);
  console.log(`pod-a-evict-status=${resultA.status}`);

  const resultB = await evict(podB);
  console.log(`pod-b=${podB}`);
  console.log(`pod-b-evict-status=${resultB.status}`);
  console.log(`pod-b-evict-body=${resultB.body}`);
} finally {
  proxy.kill();
}
