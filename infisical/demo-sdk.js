// Bonus (no points) — fetches a secret directly via Infisical's Node SDK,
// authenticated as the machine identity. No `infisical run`, no env
// injection: the app's own code calls the store, on demand.
//
//   node infisical/demo-sdk.js dev
//   node infisical/demo-sdk.js prod
//
// Worth noticing: because this fetches fresh on every call rather than once
// at process start, calling it again after editing the value in the UI/CLI
// picks up the change immediately — no restart, no `--watch`. Same idea as
// the pg.Pool password function from point 4 (re-read on every use, not
// frozen at startup), just against a remote store instead of a local file.
import { InfisicalSDK } from '@infisical/sdk';
import { readFileSync } from 'node:fs';

const credsPath = new URL('.secrets/machine-identity.env', import.meta.url);
const creds = Object.fromEntries(
  readFileSync(credsPath, 'utf8')
    .split('\n')
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const i = line.indexOf('=');

      return [line.slice(0, i), line.slice(i + 1)];
    }),
);

const environment = process.argv[2] ?? 'dev';

const client = new InfisicalSDK({ siteUrl: creds.INFISICAL_URL });

await client.auth().universalAuth.login({
  clientId: creds.INFISICAL_CLIENT_ID,
  clientSecret: creds.INFISICAL_CLIENT_SECRET,
});

const secret = await client.secrets().getSecret({
  environment,
  projectId: creds.INFISICAL_PROJECT_ID,
  secretName: 'DEMO_SECRET',
});

console.log(`[${environment}] DEMO_SECRET = ${secret.secretValue}`);
