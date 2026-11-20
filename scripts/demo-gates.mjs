// HW #32 demo:gates — four quality gates, each run twice with the same
// tool: on correct input (<gate>-ok must be 0) and on a deliberately
// broken one (<gate>-broken must be non-zero). Every value printed is the
// tool's real exit code. Exit 1 if any gate is one-sided.
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

const OASDIFF_IMAGE = 'tufin/oasdiff:v1.32.1';
const IMAGE = 'nodejspro-ecom-api:k8s';

// Returns the exit code; the tool's own output is kept, trimmed, on stderr
// so a reader sees WHY a broken input failed.
function run(label, cmd, args, env = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
  });

  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n');

  console.error(`--- ${label}: exit ${r.status}`);
  console.error(out.slice(-6).join('\n'));

  return r.status ?? -1;
}

function typesGate() {
  const ok =
    run('types-ok tsc', 'npx', ['tsc', '--noEmit']) ||
    run('types-ok eslint', 'npx', ['eslint', './', '--max-warnings', '0']);
  const broken = run('types-broken', 'npx', [
    'tsc',
    '--noEmit',
    '-p',
    'fixtures/gates/types-broken/tsconfig.json',
  ]);

  return [ok, broken];
}

// The real spec vs itself + a new optional field (compatible), and vs a
// copy with a required response field removed (breaking).
function contractGate() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'hw32-gates-'));

  try {
    const specText = readFileSync('openapi/openapi.yaml', 'utf8');

    writeFileSync(path.join(tmp, 'base.yaml'), specText);

    const compatible = YAML.parse(specText);

    compatible.components.schemas.Order.properties.note = { type: 'string' };
    writeFileSync(
      path.join(tmp, 'compatible.yaml'),
      YAML.stringify(compatible),
    );

    const breaking = YAML.parse(specText);
    const order = breaking.components.schemas.Order;

    delete order.properties.total_cents;
    order.required = order.required.filter(f => f !== 'total_cents');
    writeFileSync(path.join(tmp, 'breaking.yaml'), YAML.stringify(breaking));

    const oasdiff = head =>
      run(`contract ${head}`, 'docker', [
        'run',
        '--rm',
        '-v',
        `${tmp}:/o`,
        OASDIFF_IMAGE,
        'breaking',
        '/o/base.yaml',
        `/o/${head}`,
        '--fail-on',
        'ERR',
      ]);

    return [oasdiff('compatible.yaml'), oasdiff('breaking.yaml')];
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function archGate() {
  const depcruise = dir =>
    run(`arch ${dir}`, 'npx', [
      'depcruise',
      '--no-progress',
      '--validate',
      '.dependency-cruiser.cjs',
      dir,
    ]);

  return [depcruise('src'), depcruise('fixtures/gates/arch-broken/src')];
}

// HW #28's npm run scan, unchanged; only SCAN_MAX differs.
function scanGate() {
  const hasImage =
    spawnSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore' })
      .status === 0;

  if (!hasImage) {
    // Same dummy token scan.yml uses: no real private registry exists.
    if (!existsSync('.npm_token'))
      writeFileSync('.npm_token', 'ci-dummy-token');
    run('image:build', 'npm', ['run', 'image:build']);
  }

  return [
    run('scan-ok', 'npm', ['run', 'scan'], { SCAN_MAX: '99999' }),
    run('scan-broken', 'npm', ['run', 'scan'], { SCAN_MAX: '-1' }),
  ];
}

async function main() {
  const results = {
    types: typesGate(),
    contract: contractGate(),
    arch: archGate(),
    scan: scanGate(),
  };
  let oneSided = 0;

  for (const [gate, [ok, broken]] of Object.entries(results)) {
    console.log(`${gate}-ok=${ok}`);
    console.log(`${gate}-broken=${broken}`);

    if (ok !== 0 || broken === 0) oneSided++;
  }

  console.log(`one-sided=${oneSided}`);
  process.exitCode = oneSided === 0 ? 0 : 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
