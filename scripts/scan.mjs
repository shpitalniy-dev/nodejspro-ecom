// HW #28, criterion 4 — the image scan gate. `found` is counted from a
// real trivy JSON report, never printed from a guess, so the same script
// gives a different `gate=` verdict depending on SCAN_MAX alone.
import { spawnSync } from 'node:child_process';

const IMAGE = 'nodejspro-ecom-api:k8s';
const TRIVY = 'aquasec/trivy:0.74.0';
const CACHE_VOLUME = 'nodejspro-ecom-trivy-cache';
const SEVERITY = 'CRITICAL,HIGH';
// Baseline measured against this image on 2026-11-07 (found=17); the CVE
// DB updates daily, so this will drift — rerun `npm run scan` occasionally
// and update it to the current real `found=` value.
const DEFAULT_SCAN_MAX = 17;

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });

  return {
    code: r.status ?? -1,
    out: (r.stdout ?? '').trim(),
    err: (r.stderr ?? '').trim(),
  };
}

if (
  run('docker', ['image', 'inspect', IMAGE, '--format', '{{.Id}}']).code !== 0
) {
  console.error(`image ${IMAGE} not found — run "npm run image:build" first`);
  process.exit(1);
}

run('docker', ['volume', 'create', CACHE_VOLUME]);

const scan = run('docker', [
  'run',
  '--rm',
  '-v',
  '/var/run/docker.sock:/var/run/docker.sock',
  '-v',
  `${CACHE_VOLUME}:/root/.cache/`,
  TRIVY,
  'image',
  '--quiet',
  '--scanners',
  'vuln',
  '--severity',
  SEVERITY,
  '--format',
  'json',
  IMAGE,
]);

let found;

try {
  const report = JSON.parse(scan.out);

  found = 0;

  for (const result of report.Results ?? []) {
    found += (result.Vulnerabilities ?? []).length;
  }
} catch {
  console.error(
    `could not parse trivy output: ${(scan.err || scan.out).slice(0, 300)}`,
  );
  process.exit(1);
}

const scanMax = Number(process.env.SCAN_MAX ?? DEFAULT_SCAN_MAX);
const gate = found <= scanMax ? 'pass' : 'fail';

console.log(`image=${IMAGE}`);
console.log(`severity=${SEVERITY}`);
console.log(`found=${found}`);
console.log(`max-allowed=${scanMax}`);
console.log(`gate=${gate}`);
process.exit(gate === 'pass' ? 0 : 1);
