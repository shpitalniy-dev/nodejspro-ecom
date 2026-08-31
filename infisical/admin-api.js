// Shared REST client for the bootstrap script, adapted from Lecture 11's own
// stages/08-infisical/admin-api.mjs.
//
// Human authentication (instance admin) lives here. The app itself never
// uses it — it gets a machine identity with Universal Auth instead. The
// split is deliberate: the admin manages the store, the machine only reads
// its own project.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const SECRETS_DIR = join(HERE, '.secrets');
export const ADMIN_FILE = join(SECRETS_DIR, 'admin.json');
export const MACHINE_FILE = join(SECRETS_DIR, 'machine-identity.env');
export const STATE_FILE = join(SECRETS_DIR, 'stand.json');

export const API = process.env.INFISICAL_URL ?? 'http://localhost:8090';
export const ORG_NAME = 'NodejsProEcom';
export const PROJECT_NAME = 'nodejspro-ecom';
export const IDENTITY_NAME = 'nodejspro-ecom-app';

export const log = s => process.stdout.write(`${s}\n`);
export const ok = s => log(`  \x1b[0;32m✓\x1b[0m ${s}`);
export const note = s => log(`  \x1b[0;90m${s}\x1b[0m`);

export function makeClient() {
  let token = null;
  const client = {
    setToken(t) {
      token = t;
    },
    async call(method, path, body) {
      const res = await fetch(API + path, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let json;

      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }

      return { status: res.status, okStatus: res.ok, json };
    },
    async must(method, path, body, what) {
      const r = await client.call(method, path, body);

      if (!r.okStatus) {
        throw new Error(
          `${what}: ${method} ${path} → ${r.status}\n    ${JSON.stringify(r.json).slice(0, 400)}`,
        );
      }

      return r.json;
    },
  };

  return client;
}

// Admin login + the mandatory exchange for an org-scoped token.
// Skip select-organization and every later project call returns 401 "no
// organization found in request" — the single longest gotcha in this flow.
export async function loginAsAdmin(client) {
  if (!existsSync(ADMIN_FILE)) {
    throw new Error(
      'Missing .secrets/admin.json — run bash infisical/up.sh first.',
    );
  }

  const admin = JSON.parse(readFileSync(ADMIN_FILE, 'utf8'));

  const login = await client.must(
    'POST',
    '/api/v3/auth/login',
    admin,
    'admin login',
  );
  client.setToken(login.accessToken);

  const orgs = await client.must(
    'GET',
    '/api/v1/organization',
    undefined,
    'list organizations',
  );
  const org =
    orgs.organizations.find(o => o.name === ORG_NAME) ?? orgs.organizations[0];

  const scoped = await client.must(
    'POST',
    '/api/v3/auth/select-organization',
    { organizationId: org.id },
    'select organization',
  );
  client.setToken(scoped.token);

  return { admin, org };
}

export function loadState() {
  if (!existsSync(STATE_FILE)) {
    throw new Error(
      'Missing .secrets/stand.json — run bash infisical/up.sh first.',
    );
  }

  return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
}
