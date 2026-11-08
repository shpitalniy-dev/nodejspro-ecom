// HW #28 — HorizontalPodAutoscaler: proves it actually scales under
// real CPU load (metrics-server, not a mock), not just that the
// resource exists. Load is deliberately *concurrent* (many parallel
// workers), unlike demo-rollout.mjs's sequential loop — a handful of
// requests per second won't meaningfully exceed the container's `100m`
// CPU request. Every number below is a live `kubectl` read, never
// guessed.
//
// Only needs cluster access — the 30s scaleDown.stabilizationWindowSeconds
// is this dev stack's own permanent setting (web-service.ts), not a
// toggle this script sets, so no pulumi/JWT secrets needed here.
import { spawnSync } from 'node:child_process';

const SERVICE_URL = 'http://localhost:8080/healthz';
const NAMESPACE = 'nodejspro-ecom';
const WORKERS = 60;
const LOAD_DURATION_MS = 90_000;
const POLL_INTERVAL_MS = 5_000;
const COOLDOWN_MS = 90_000; // comfortably longer than the 30s stabilization window

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function snapshot(label) {
  const hpa = spawnSync(
    'kubectl',
    [
      '-n',
      NAMESPACE,
      'get',
      'hpa',
      '-o',
      'custom-columns=NAME:.metadata.name,TARGETS:.status.currentMetrics[0].resource.current.averageUtilization,REPLICAS:.status.currentReplicas',
      '--no-headers',
    ],
    { encoding: 'utf8' },
  ).stdout.trim();

  const pods = spawnSync(
    'kubectl',
    ['-n', NAMESPACE, 'get', 'pods', '--no-headers'],
    { encoding: 'utf8' },
  ).stdout.trim();

  console.log(`\n--- ${label} ---`);
  console.log(`hpa: ${hpa}`);
  console.log(`pods:\n${pods}`);
}

async function worker(stopAt) {
  while (Date.now() < stopAt) {
    try {
      await fetch(SERVICE_URL, { signal: AbortSignal.timeout(2000) });
    } catch {
      // ignore — this is load generation, not a correctness check
    }
  }
}

console.log(
  `starting ${WORKERS} concurrent workers against ${SERVICE_URL} for ${LOAD_DURATION_MS}ms`,
);
snapshot('before load');

const stopAt = Date.now() + LOAD_DURATION_MS;
const workers = Array.from({ length: WORKERS }, () => worker(stopAt));

const pollUntilLoadEnds = (async () => {
  while (Date.now() < stopAt) {
    await sleep(POLL_INTERVAL_MS);
    snapshot('during load');
  }
})();

await Promise.all([...workers, pollUntilLoadEnds]);

console.log('\nload stopped — watching for scale-down');
const cooldownEnd = Date.now() + COOLDOWN_MS;

while (Date.now() < cooldownEnd) {
  await sleep(POLL_INTERVAL_MS);
  snapshot('cooldown');
}
