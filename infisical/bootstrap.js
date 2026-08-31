// Populates an empty Infisical instance via its own REST API, adapted from
// Lecture 11's stages/08-infisical/bootstrap.mjs.
//
// Call order (each verified against a live Infisical v0.162.19):
//   1. POST /api/v1/admin/bootstrap                — first admin + org
//   2. POST /api/v3/auth/login                     — human token (email+password)
//   3. POST /api/v3/auth/select-organization       — without this the token is "org-less"
//   4. POST /api/v1/projects                       — project (dev/staging/prod envs included)
//   5. POST /api/v3/secrets/raw/{name}             — the secret, once per environment
//   6. POST /api/v1/identities                     — machine identity
//   7. POST /api/v1/auth/universal-auth/identities/{id}                — enable UA
//   8. POST /api/v1/auth/universal-auth/identities/{id}/client-secrets — clientSecret
//   9. POST /api/v1/projects/{projectId}/identity-memberships/{id}     — project access
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import {
  ADMIN_FILE,
  API,
  IDENTITY_NAME,
  loginAsAdmin,
  MACHINE_FILE,
  makeClient,
  note,
  ok,
  ORG_NAME,
  PROJECT_NAME,
  SECRETS_DIR,
  STATE_FILE,
} from './admin-api.js';

const hex = n => randomBytes(n).toString('hex');

// Values are generated, not literals in this file — otherwise they'd be in
// git, exactly the problem this whole bonus is demonstrating an escape from.
const SECRETS = {
  dev: { DEMO_SECRET: `dev-${hex(8)}` },
  prod: { DEMO_SECRET: `PROD-${hex(8)}` },
};

// Instance password policy: >=14 chars, a letter, a digit/symbol, no more
// than 3 identical characters in a row.
const genPassword = () => `NJPE-${randomBytes(12).toString('base64url')}-x9`;

const client = makeClient();
mkdirSync(SECRETS_DIR, { recursive: true });

// -- 1. Admin + organization -------------------------------------------------
const { config } = await client.must(
  'GET',
  '/api/v1/admin/config',
  undefined,
  'read admin config',
);

if (!config.initialized) {
  const admin = {
    email: 'admin@nodejspro-ecom.local',
    password: genPassword(),
  };

  await client.must(
    'POST',
    '/api/v1/admin/bootstrap',
    { ...admin, organization: ORG_NAME },
    'bootstrap instance',
  );
  writeFileSync(ADMIN_FILE, JSON.stringify(admin, null, 2), { mode: 0o600 });
  ok(`instance initialized, admin ${admin.email}`);
} else if (!existsSync(ADMIN_FILE)) {
  throw new Error(
    'Instance is already initialized, but .secrets/admin.json is missing — the admin\n' +
      "    password is no longer known (it's shown exactly once). Simplest fix — wipe\n" +
      '    the volume and start over: bash infisical/down.sh && bash infisical/up.sh',
  );
} else {
  ok(
    `instance already initialized, logging in as ${JSON.parse(readFileSync(ADMIN_FILE, 'utf8')).email}`,
  );
}

// -- 2-3. Human token + org binding ------------------------------------------
const { admin, org } = await loginAsAdmin(client);

ok(`organization ${org.name} (${org.slug})`);

// -- 4. Project ---------------------------------------------------------------
const existing = await client.must(
  'GET',
  `/api/v2/organizations/${org.id}/workspaces`,
  undefined,
  'list projects',
);
let project = existing.workspaces?.find(w => w.name === PROJECT_NAME);

if (!project) {
  const created = await client.must(
    'POST',
    '/api/v1/projects',
    {
      projectName: PROJECT_NAME,
      type: 'secret-manager',
      shouldCreateDefaultEnvs: true,
    },
    'create project',
  );

  project = created.project ?? created;
  ok(`project ${PROJECT_NAME} created`);
} else {
  ok(`project ${PROJECT_NAME} already exists`);
}

const envSlugs = (project.environments ?? []).map(e => e.slug);

ok(`environments: ${envSlugs.join(', ')}`);

// -- 5. Secrets -----------------------------------------------------------
// POST creates, a rerun skips keys that already exist — idempotent, and a
// second bootstrap run never silently rotates a value out from under you.
for (const [envSlug, kv] of Object.entries(SECRETS)) {
  const list = await client.call(
    'GET',
    `/api/v3/secrets/raw?workspaceId=${project.id}&environment=${envSlug}&secretPath=%2F`,
  );
  const present = new Set((list.json.secrets ?? []).map(s => s.secretKey));

  let written = 0;

  for (const [key, value] of Object.entries(kv)) {
    if (present.has(key)) continue;
    await client.must(
      'POST',
      `/api/v3/secrets/raw/${key}`,
      {
        workspaceId: project.id,
        environment: envSlug,
        secretPath: '/',
        secretValue: value,
      },
      `write secret ${key} in ${envSlug}`,
    );
    written += 1;
  }

  ok(
    written
      ? `${envSlug}: wrote ${written} value(s)`
      : `${envSlug}: value already present, leaving it`,
  );
}

// -- 6-8. Machine identity + Universal Auth -----------------------------
// This is what the PROCESS uses, not a human. The clientId/clientSecret pair
// is the only thing the app knows about the store — it never sees the
// secret values' storage location, only the values themselves at runtime.
const idsPage = await client.must(
  'GET',
  `/api/v2/organizations/${org.id}/identity-memberships`,
  undefined,
  'list identities',
);
let identity = idsPage.identityMemberships?.find(
  m => m.identity?.name === IDENTITY_NAME,
)?.identity;

if (!identity) {
  const created = await client.must(
    'POST',
    '/api/v1/identities',
    { name: IDENTITY_NAME, organizationId: org.id, role: 'member' },
    'create machine identity',
  );

  identity = created.identity;
  ok(`machine identity ${IDENTITY_NAME} created`);
} else {
  ok(`machine identity ${IDENTITY_NAME} already exists`);
}

// Enable Universal Auth. A 400 here because it's already enabled isn't a failure.
const ua = await client.call(
  'POST',
  `/api/v1/auth/universal-auth/identities/${identity.id}`,
  {
    accessTokenTTL: 7200,
    accessTokenMaxTTL: 86400,
    accessTokenNumUsesLimit: 0,
  },
);

if (!ua.okStatus && !/already/i.test(JSON.stringify(ua.json))) {
  throw new Error(
    `Universal Auth: ${ua.status} ${JSON.stringify(ua.json).slice(0, 300)}`,
  );
}

const uaCfg = await client.must(
  'GET',
  `/api/v1/auth/universal-auth/identities/${identity.id}`,
  undefined,
  'read UA config',
);
const clientId = uaCfg.identityUniversalAuth.clientId;

// clientSecret is returned exactly once, in the creation response — it can't
// be read back later (the API only keeps a prefix + description). Written to
// disk immediately; a rerun mints a NEW clientSecret without revoking the
// old one, acceptable for a local stand, a real deployment would revoke it.
const cs = await client.must(
  'POST',
  `/api/v1/auth/universal-auth/identities/${identity.id}/client-secrets`,
  {
    description: `nodejspro-ecom bootstrap ${new Date().toISOString()}`,
    numUsesLimit: 0,
    ttl: 0,
  },
  'create clientSecret',
);

ok('Universal Auth: clientId + clientSecret ready');

// -- 9. Project access --------------------------------------------------------
// viewer = read secrets, nothing else. The app has no reason to write them.
const member = await client.call(
  'POST',
  `/api/v1/projects/${project.id}/identity-memberships/${identity.id}`,
  {
    roles: [{ role: 'viewer' }],
  },
);

if (member.okStatus) ok('identity added to the project with role viewer');
else if (/already/i.test(JSON.stringify(member.json)))
  ok('identity already in the project');
else
  throw new Error(
    `project access: ${member.status} ${JSON.stringify(member.json).slice(0, 300)}`,
  );

// -- Result -----------------------------------------------------------------
writeFileSync(
  MACHINE_FILE,
  [
    '# MACHINE credentials (not a human). The only thing the app knows about the store.',
    '# No secret values here — only a key to the store. This file is gitignored.',
    `INFISICAL_URL=${API}`,
    `INFISICAL_PROJECT_ID=${project.id}`,
    `INFISICAL_CLIENT_ID=${clientId}`,
    `INFISICAL_CLIENT_SECRET=${cs.clientSecret}`,
    '',
  ].join('\n'),
  { mode: 0o600 },
);

writeFileSync(
  STATE_FILE,
  JSON.stringify(
    {
      api: API,
      orgId: org.id,
      projectId: project.id,
      projectSlug: project.slug,
      identityId: identity.id,
      environments: envSlugs,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);

note('');
note(`UI:           ${API}`);
note(`login:        ${admin.email} / password in .secrets/admin.json`);
note(`projectId:    ${project.id}`);
note(`clientId:     ${clientId}`);
note(
  `clientSecret: ${cs.clientSecret.slice(0, 8)}…  (full value in .secrets/machine-identity.env)`,
);
note('Secret values were generated randomly and are not printed above — they');
note(
  'live only in the store. See them via the UI, or: bash infisical/run.sh dev env',
);
