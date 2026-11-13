// HW #28, criteria 2 & 3 — production image is multi-stage/non-root/
// shell-free, and the build-time secret never lands in the image. Every
// number below is computed from a live `docker` command against the
// actual built image, never printed from a guess.
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
} from 'node:fs';
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

function isGzip(file) {
  const fd = openSync(file, 'r');
  const head = Buffer.alloc(2);
  readSync(fd, head, 0, 2, 0);
  closeSync(fd);

  return head[0] === 0x1f && head[1] === 0x8b;
}

async function main() {
  if (
    run('docker', ['image', 'inspect', IMAGE, '--format', '{{.Id}}']).code !== 0
  ) {
    throw new Error(
      `image ${IMAGE} not found — run "npm run image:build" first`,
    );
  }

  if (!existsSync('.npm_token')) {
    throw new Error(
      '.npm_token not found — needed to know which secret value to search for',
    );
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

  const dir = mkdtempSync(join(tmpdir(), 'demo-image-'));
  let tokenInConfig = 0;
  let tokenInLayers = 0;

  try {
    run('bash', ['-c', `docker save '${IMAGE}' | tar -x -C '${dir}'`]);

    // Docker 29 gzips layer blobs inside `docker save`'s own tar (earlier
    // versions wrote them uncompressed) — caught in review: a
    // negative-control rebuild that baked the token into a layer on
    // purpose still measured 0 here, because grep can't see a literal
    // token inside gzip. Decompress every gzip-compressed file in place
    // first, by magic bytes rather than filename, so this holds
    // regardless of which files `docker save` happens to compress.
    const allFiles = run('find', [dir, '-type', 'f'])
      .out.split('\n')
      .filter(Boolean);

    for (const file of allFiles) {
      if (!isGzip(file)) continue;
      run('bash', [
        '-c',
        `gzip -dc '${file}' > '${file}.tmp' && mv '${file}.tmp' '${file}'`,
      ]);
    }

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
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
