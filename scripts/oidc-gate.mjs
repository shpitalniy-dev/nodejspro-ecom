// HW #32, criterion 6 — the OIDC gate. The same code runs in the pipeline
// (CLI mode below, on a real GitHub ID token) and in demo:oidc (imported,
// on tokens signed with a throwaway local key). Two independent answers:
//   sig-verified — RS256 signature matches a key from jwks_uri, iss/exp ok
//   policy-allow — the trust policy's aud and sub conditions hold
// It never knows where it runs: iss, the JWKS address and the policy file
// are all parameters. Adapted from the lecture's code/32 oidc/gate.mjs.
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ISSUER_HOST = 'token.actions.githubusercontent.com';

const b64json = s => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

export function decodeClaims(token) {
  try {
    return b64json(token.split('.')[1]);
  } catch {
    return {};
  }
}

async function fetchJson(url) {
  const res = await fetch(url);

  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);

  return res.json();
}

export function verifySignature(
  token,
  jwks,
  { iss, now = Math.floor(Date.now() / 1000) },
) {
  const parts = token.split('.');

  if (parts.length !== 3 || !parts[2])
    return { ok: false, reason: 'no-signature' };

  const header = b64json(parts[0]);
  const payload = b64json(parts[1]);

  if (header.alg !== 'RS256') return { ok: false, reason: `alg-${header.alg}` };

  const jwk = jwks.keys.find(k => k.kid === header.kid);

  if (!jwk) return { ok: false, reason: 'unknown-kid' };

  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const sigOk = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    key,
    Buffer.from(parts[2], 'base64url'),
  );

  if (!sigOk) return { ok: false, reason: 'bad-signature' };
  if (payload.iss !== iss) return { ok: false, reason: 'iss' };
  if (!(payload.exp > now)) return { ok: false, reason: 'expired' };

  return { ok: true, payload };
}

// AWS StringLike: * is any run of characters, ? exactly one. Case-sensitive.
const like = (value, pattern) =>
  new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}$`,
  ).test(value);

export function evaluatePolicy(policy, payload) {
  const claim = key => payload[key.slice(ISSUER_HOST.length + 1)];

  return policy.Statement.some(st => {
    if (st.Effect !== 'Allow' || st.Action !== 'sts:AssumeRoleWithWebIdentity')
      return false;

    const eq = st.Condition?.StringEquals ?? {};
    const lk = st.Condition?.StringLike ?? {};
    const eqOk = Object.entries(eq).every(([k, v]) =>
      [].concat(v).includes(claim(k)),
    );
    const lkOk = Object.entries(lk).every(([k, v]) =>
      [].concat(v).some(p => typeof claim(k) === 'string' && like(claim(k), p)),
    );

    return eqOk && lkOk;
  });
}

export async function gate(token, { jwksUrl, iss, policyFile }) {
  const jwks = await fetchJson(jwksUrl);
  const sig = verifySignature(token, jwks, { iss });
  const policy = JSON.parse(readFileSync(policyFile, 'utf8'));
  // Unverified claims are just text — the policy is never evaluated on them.
  const allow = sig.ok && evaluatePolicy(policy, sig.payload);

  return {
    sigVerified: sig.ok ? 1 : 0,
    policyAllow: allow ? 1 : 0,
    reason: sig.ok ? (allow ? 'ok' : 'policy') : sig.reason,
  };
}

// Inside a job with `id-token: write`, GitHub exposes these two env vars;
// the token is fetched here so it never passes through a shell variable,
// a step output or argv.
async function requestGithubToken(audience) {
  const url = `${process.env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${encodeURIComponent(audience)}`;
  const res = await fetch(url, {
    headers: {
      authorization: `bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`,
    },
  });

  if (!res.ok) throw new Error(`ID token request -> HTTP ${res.status}`);

  return (await res.json()).value;
}

// CLI mode (pipeline). Prints claims, never the token itself; exit 0 only
// on 1 1. OIDC_TOKEN (env, never argv) overrides the GitHub request.
async function main() {
  const token =
    process.env.OIDC_TOKEN ??
    (process.env.ACTIONS_ID_TOKEN_REQUEST_URL
      ? await requestGithubToken(process.env.OIDC_AUD ?? 'sts.amazonaws.com')
      : '');
  const iss = process.env.OIDC_ISS ?? `https://${ISSUER_HOST}`;
  const policyFile = process.env.OIDC_POLICY ?? 'oidc/policy.json';
  const jwksUrl =
    process.env.OIDC_JWKS_URL ??
    (await fetchJson(`${iss}/.well-known/openid-configuration`)).jwks_uri;
  const r = await gate(token, { jwksUrl, iss, policyFile });
  const c = decodeClaims(token);

  console.log(`oidc-iss=${c.iss ?? ''}`);
  console.log(`oidc-aud=${c.aud ?? ''}`);
  console.log(`oidc-sub=${c.sub ?? ''}`);
  console.log(`oidc-sig-verified=${r.sigVerified}`);
  console.log(`oidc-policy-allow=${r.policyAllow}`);
  console.log(`oidc-reason=${r.reason}`);
  process.exitCode = r.sigVerified === 1 && r.policyAllow === 1 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
