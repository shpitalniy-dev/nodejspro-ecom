// Bonus (no points) demo — proves a secret can reach a process without ever
// touching disk, via `infisical run`. Deliberately not wired into the real
// app: DatabaseService and rotate.sh are untouched, and stay on the
// file-based mechanism from point 4.
//
//   node infisical/demo.mjs                          → ✗ undefined, nothing on disk
//   infisical run --env=dev -- node infisical/demo.mjs → ✓ value injected at exec
const value = process.env.DEMO_SECRET;

console.log(
  value
    ? `DEMO_SECRET = ${value}`
    : 'DEMO_SECRET is not set — run this via `infisical run`, not plain `node`.',
);
