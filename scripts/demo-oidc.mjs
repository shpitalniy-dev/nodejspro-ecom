// HW #32 demo:oidc — three tokens, the SAME gate the pipeline runs
// (scripts/oidc-gate.mjs), the SAME policy file (oidc/policy.json).
// Offline: a fresh RSA pair per run, its JWKS served on a random local
// port. Expected (sig-verified policy-allow): green 1 1 · foreign-sub 1 0
// · bad-signature 0 0. Exit 1 if any case disagrees.
import crypto, { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';

import { gate } from './oidc-gate.mjs';

const POLICY_FILE = 'oidc/policy.json';

async function main() {
  const policy = JSON.parse(readFileSync(POLICY_FILE, 'utf8'));
  const cond = policy.Statement[0].Condition;
  // Exact subs, no wildcards — the first one is the PR pipeline's.
  const [allowedSub] = [].concat(
    cond.StringLike['token.actions.githubusercontent.com:sub'],
  );
  const aud = cond.StringEquals['token.actions.githubusercontent.com:aud'];

  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const kid = crypto.randomBytes(8).toString('hex');
  const jwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid,
    alg: 'RS256',
    use: 'sig',
  };
  const srv = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys: [jwk] }));
  });

  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));

  try {
    const ISS = `http://127.0.0.1:${srv.address().port}`;
    const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');

    const sign = payload => {
      const head = b64({ alg: 'RS256', typ: 'JWT', kid });
      const body = b64(payload);
      const sig = crypto
        .sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey)
        .toString('base64url');

      return `${head}.${body}.${sig}`;
    };

    const now = Math.floor(Date.now() / 1000);
    const base = { iss: ISS, aud, iat: now, exp: now + 300 };
    const green = sign({ ...base, sub: allowedSub });
    // Valid signature, valid aud — only the repo in sub is someone else's.
    const foreign = sign({
      ...base,
      sub: 'repo:attacker/nodejspro-ecom:environment:prod',
    });
    const [h, p, s] = green.split('.');
    // Same header and payload as green, one signature byte flipped.
    const badSig = `${h}.${p}.${s.slice(0, 10)}${s[10] === 'A' ? 'B' : 'A'}${s.slice(11)}`;

    const cases = [
      ['green', green, [1, 1]],
      ['foreign-sub', foreign, [1, 0]],
      ['bad-signature', badSig, [0, 0]],
    ];
    let mismatches = 0;

    for (const [name, token, [sigExp, allowExp]] of cases) {
      const r = await gate(token, {
        jwksUrl: `${ISS}/jwks`,
        iss: ISS,
        policyFile: POLICY_FILE,
      });

      console.log(`case=${name}`);
      console.log(`sig-verified=${r.sigVerified}`);
      console.log(`policy-allow=${r.policyAllow}`);
      console.log(`reason=${r.reason}`);

      if (r.sigVerified !== sigExp || r.policyAllow !== allowExp) mismatches++;
    }

    console.log(`mismatches=${mismatches}`);
    process.exitCode = mismatches === 0 ? 0 : 1;
  } finally {
    srv.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
