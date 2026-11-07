// HW #28, criteria 2 & 3 — production image is multi-stage/non-root/
// shell-free, and the build-time secret never lands in the image. Every
// number below is computed from a live `docker` command against the
// actual built image, never printed from a guess.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DOCKERFILE = 'docker/Dockerfile';
const IMAGE = 'nodejspro-ecom-api:k8s';

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

if (!existsSync('.npm_token')) {
  console.error(
    '.npm_token not found — needed to know which secret value to search for',
  );
  process.exit(1);
}

const TOKEN = readFileSync('.npm_token', 'utf8').trim();

const stages = readFileSync(DOCKERFILE, 'utf8')
  .split('\n')
  .filter(line => /^FROM\s/i.test(line)).length;

const shellInside =
  run('docker', ['run', '--rm', '--entrypoint', 'sh', IMAGE, '-c', 'true'])
    .code === 0
    ? 1
    : 0;

const runtimeUid = run('docker', [
  'image',
  'inspect',
  IMAGE,
  '--format',
  '{{.Config.User}}',
]).out;

const history = run('docker', [
  'history',
  '--no-trunc',
  '--format',
  '{{.CreatedBy}}',
  IMAGE,
]).out;
const tokenInHistory = history
  .split('\n')
  .filter(line => line.includes(TOKEN)).length;

// shortcut: assumes `docker save` writes layer blobs uncompressed, which
// holds for this Docker/BuildKit version but isn't a format guarantee —
// if a negative-control rebuild (token via ARG/COPY) ever shows 0 leaks
// here when it shouldn't, this assumption is the first thing to check.
const dir = mkdtempSync(join(tmpdir(), 'demo-image-'));
let tokenInConfig = 0;
let tokenInLayers = 0;

try {
  run('bash', ['-c', `docker save '${IMAGE}' | tar -x -C '${dir}'`]);
  const hits = run('grep', ['-rlaF', TOKEN, dir])
    .out.split('\n')
    .filter(Boolean);

  for (const file of hits) {
    if (run('tar', ['-tf', file]).code === 0) {
      tokenInLayers += 1;
    } else {
      tokenInConfig += Number(run('grep', ['-coF', TOKEN, file]).out || 0);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`stages=${stages}`);
console.log(`shell-inside=${shellInside}`);
console.log(`runtime-uid=${runtimeUid}`);
console.log(`token-in-history=${tokenInHistory}`);
console.log(`token-in-config=${tokenInConfig}`);
console.log(`token-in-layers=${tokenInLayers}`);
