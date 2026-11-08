// HW #28, criteria 6 & 7 — proves zero-downtime depends on the
// probes/strategy, not luck: runs a real HTTP load generator through a
// real rolling update, once with hardened:false (no probes, default
// strategy) and once with hardened:true, and reports what actually got
// dropped. Every number below is measured live, never guessed.
//
// Needs the same shell state `npm run up` needs: JWT_KID/JWT_PRIVATE_KEY/
// JWT_PUBLIC_KEY/REFRESH_TOKEN_PEPPER and PULUMI_BACKEND_URL/
// PULUMI_CONFIG_PASSPHRASE already exported (see README's
// "### HW #28 commands"). infra/index.ts's own validation fails by name
// if any are missing.
import { spawn, spawnSync } from 'node:child_process';

const SERVICE_URL = 'http://localhost:8080/healthz';
// Comfortably longer than the readiness-probe/kube-proxy propagation lag
// this whole HW is about, short enough to keep the demo quick.
const WARMUP_MS = 1500;
const LOAD_DURATION_MS = 25_000;
const LOAD_INTERVAL_MS = 100;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Blocking — only used to settle to a baseline before load starts, when
// nothing needs to run concurrently.
function settleSync(envOverrides) {
  const r = spawnSync('npm', ['run', 'up'], {
    stdio: 'inherit',
    env: { ...process.env, ...envOverrides },
  });

  if (r.status !== 0) {
    throw new Error(`npm run up failed (env=${JSON.stringify(envOverrides)})`);
  }
}

// Non-blocking — used to trigger the rollout *while* the load generator
// below is running. spawnSync would freeze the event loop and the load
// generator's fetch loop would never get a turn during the rollout.
function settleAsync(envOverrides) {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'up'], {
      stdio: 'inherit',
      env: { ...process.env, ...envOverrides },
    });

    child.on('exit', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(`npm run up failed (env=${JSON.stringify(envOverrides)})`),
        );
      }
    });
  });
}

async function runLoad(durationMs) {
  const start = Date.now();
  const results = [];

  while (Date.now() - start < durationMs) {
    const t = Date.now() - start;

    try {
      const res = await fetch(SERVICE_URL, {
        signal: AbortSignal.timeout(1000),
      });

      results.push({
        t,
        outcome: res.status === 200 ? 'ok' : `http-${res.status}`,
      });
    } catch {
      results.push({ t, outcome: 'network-error' });
    }

    await sleep(LOAD_INTERVAL_MS);
  }

  return results;
}

function report(name, results) {
  const total = results.length;
  const failures = results.filter(r => r.outcome !== 'ok');
  const firstFail = failures[0];
  const lastFail = failures[failures.length - 1];

  console.log(`\n=== ${name} ===`);
  console.log(`total=${total}`);
  console.log(`failures=${failures.length}`);
  console.log(
    `failure-rate=${total ? ((failures.length / total) * 100).toFixed(1) : '0.0'}%`,
  );

  if (firstFail) {
    console.log(`first-failure-at-ms=${firstFail.t}`);
    console.log(`last-failure-at-ms=${lastFail.t}`);
  }
}

async function phase(name, hardened, revBase) {
  settleSync({
    HARDENED: String(hardened),
    WARMUP_MS: String(WARMUP_MS),
    REV: String(revBase),
  });

  // Let the baseline settle fully land before measuring anything
  await sleep(WARMUP_MS + 1500);

  const loadPromise = runLoad(LOAD_DURATION_MS);

  // Let the load generator get a few steady-state requests in first
  await sleep(1000);

  await settleAsync({
    HARDENED: String(hardened),
    WARMUP_MS: String(WARMUP_MS),
    REV: String(revBase + 1),
  });

  report(name, await loadPromise);
}

try {
  await phase('broken (hardened:false)', false, 2);
  await phase('hardened (hardened:true)', true, 4);
} finally {
  console.log(
    '\nrestoring committed defaults (hardened:true, WARMUP_MS:0, REV:1)...',
  );
  settleSync({ HARDENED: 'true', WARMUP_MS: '0', REV: '1' });
}
