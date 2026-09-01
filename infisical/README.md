# Infisical integration

Infisical Cloud is the source of truth for `app_user`'s Postgres password.
`DatabaseService` reads it from a file (`DB_PASSWORD_FILE_INFISICAL`,
default `/shared-secrets/db-password`) kept current by `infisical-agent` —
a sidecar container, not a library the app talks to directly. `api` has no
Infisical credentials, no SDK, no network call to Infisical at all; it just
reads a file, exactly like it already does for `DB_PASSWORD_FILE`.

## File map

| File                                 | Runs where                  | Purpose                                                                                                                  |
| ------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `Dockerfile`                         | —                           | `infisical/cli:0.43.128` + `postgresql-client` (needed by `on-change.sh`'s `psql` calls)                                 |
| `agent-config.yaml`                  | in-container                | Agent config: auth, and the two templates it renders on a 60s poll                                                       |
| `entrypoint.sh`                      | in-container, once at start | Clears stale output, renders templates, launches `reconcile.sh` in the background, then `exec`s the Agent                |
| `on-change.sh`                       | in-container                | Syncs Postgres to whatever's currently in the rendered file. Safe to call repeatedly — no-op if Postgres already matches |
| `reconcile.sh`                       | in-container, once at start | Backup path: waits (bounded, up to 60s) for the Agent's first render, then calls `on-change.sh` once                     |
| `rotate.sh`                          | on the host                 | Pushes a new `DB_PASSWORD` value to Infisical Cloud. Doesn't touch Postgres itself                                       |
| `templates/template.txt`             | in-container                | Renders `DEMO_SECRET`'s value — a standalone proof-of-mechanism, not consumed anywhere                                   |
| `templates/db-password-template.txt` | in-container                | Renders `DB_PASSWORD`'s value — this is the one that matters                                                             |
| `configs/project_id`                 | committed                   | Infisical project ID — not a secret, safe to commit (grants no access alone)                                             |
| `configs/client_id`                  | committed                   | The reader identity's client ID — not a secret either, same reasoning                                                    |
| `configs/rotator_client_id`          | committed                   | The rotator identity's client ID                                                                                         |
| `secrets/client_secret`              | gitignored                  | The reader identity's client secret — the actual credential                                                              |
| `secrets/rotator_client_secret`      | gitignored                  | The rotator identity's client secret                                                                                     |

## Two machine identities, deliberately separate

- **Reader** (`client_id`/`client_secret`) — `viewer` role only. Used by
  `infisical-agent` to fetch secret values. Can never write anything, even
  if compromised.
- **Rotator** (`rotator_client_id`/`rotator_client_secret`) — write-scoped.
  Used only by `rotate.sh`, on the host, to push new `DB_PASSWORD` values.
  Never used by anything running in a container.

Splitting these means the identity that's baked into a long-running
container (the reader) never has write access, regardless of what happens
to that container.

## How Postgres actually gets synced

Two independent paths, both funneling into the same safe, idempotent
`on-change.sh`:

1. **The Agent's own `execute` hook** (`agent-config.yaml`) — fires
   whenever the Agent's _own_ diff sees the rendered file's content change.
   This is edge-triggered: it depends on detecting a transition, which
   turned out to be fragile in one specific way (see below).
2. **`reconcile.sh`** — level-triggered. Doesn't try to detect a change at
   all; it just waits for the Agent's first render to exist, then
   unconditionally re-syncs. This is the guaranteed backstop, run once at
   container start.

`on-change.sh` itself: reads the current rendered password, first checks
whether Postgres _already_ accepts it (a plain `SELECT 1` as `app_user`) —
if so, exits immediately, doing nothing. Only if that fails does it run
`ALTER ROLE` (as the admin identity) and terminate `app_user`'s existing
connections, so the app's pool is forced to reconnect with the new value.
That "check first" behavior is what makes it safe to call from both the
reactive hook and the unconditional backstop without ever double-rotating
or needlessly dropping live connections.

## The bug that shaped this design

Early on, `on-change.sh` only ran via the Agent's own hook. That failed
silently in a real scenario: `postgres_data` and `infisical_secrets` are
separate named volumes that can get reset independently. If Postgres gets a
fresh `init.sql` password but the `infisical_secrets` volume still has a
stale-but-unchanged render from before, the Agent's fetch produces the
_same_ content as what's already on disk — from its point of view, nothing
changed, so the hook never fires, and Postgres never gets corrected.

`entrypoint.sh` fixes the root cause directly: it deletes
`/shared-secrets/demo-secret` and `/shared-secrets/db-password` before the
Agent ever starts, so its first render this container instance is always a
transition from nothing to something — guaranteeing the hook fires on every
startup. `reconcile.sh` stays on top of that as an independent check,
specifically because this vendor's Agent has surprised us with undocumented
behavior more than once (no env-var support in templates, no health/status
endpoint, `psql`'s own `-v` substitution not firing as documented) — one
mechanism failing quietly wasn't something to build the whole guarantee on.

## Startup sequence

```
postgres starts → init.sql runs (fresh volume only) → postgres healthy
  → infisical-agent starts:
      1. rm -f the old rendered files
      2. render templates (env + project id substituted in)
      3. launch reconcile.sh in the background
      4. exec into the long-running Agent (authenticates, fetches, renders,
         its own hook fires — reliably, per the fix above)
  → infisical-agent's healthcheck passes once /shared-secrets/db-password's
    *current* content genuinely authenticates against Postgres
  → api starts, reads DB_PASSWORD_FILE_INFISICAL
```

`api` depends on `infisical-agent: condition: service_healthy` — not just
`started`. That healthcheck is the actual reliability gate: it doesn't just
check a file exists, it tries to connect with it, so `api` can never start
against a password that doesn't actually work yet.

## One-time setup (in Infisical Cloud, done manually)

1. Create a project, note its ID → `configs/project_id`.
2. Add a `DB_PASSWORD` secret (and `DEMO_SECRET`, for the standalone proof)
   to the `dev` environment.
3. Create the reader identity (Universal Auth, `viewer` role) →
   `configs/client_id` / `secrets/client_secret`.
4. Create the rotator identity (Universal Auth, write role) →
   `configs/rotator_client_id` / `secrets/rotator_client_secret`.

## Running it

```bash
docker compose up --build -d --wait
```

Rotating the password:

```bash
bash infisical/rotate.sh
```

Watching it happen:

```bash
docker compose logs -f infisical-agent
```

## Known limitations

- A small race exists between `ALTER ROLE` and terminating old connections
  inside `on-change.sh` — same class of window the original file-based
  `rotate.sh` (point 4) already had. Only closed for real in production
  systems via alternating users, which this doesn't implement.
- `reconcile.sh` runs once, at start — it does not guard against a
  mid-lifetime hook failure (e.g. if you edit `DB_PASSWORD` in the UI hours
  into a container's uptime and the Agent's hook happens not to fire). The
  reactive hook is relied on for that case.
- `dev`/`staging`/`prod` are just the environment slug
  (`INFISICAL_ENV`, substituted into the templates) — nothing here spins up
  separate deployments per environment; that would need its own
  compose file/override per real deployment target.
