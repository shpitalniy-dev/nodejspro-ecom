# Bonus (no points): secrets via Infisical

Not wired into the graded HW #11 submission — `DatabaseService` and
`rotate.sh` are untouched and stay on the file-based mechanism from point 4.
This is a standalone demo of the underlying idea: a secret that reaches a
process without ever touching disk, via `infisical run`.

Two things are deliberately included here, both load-bearing for a "normal"
setup rather than a toy one:

- **A machine identity with Universal Auth**, not a human `infisical login`.
  The app authenticates with a `clientId`/`clientSecret` pair, exchanged at
  runtime for a short-lived access token — the same mechanism a CI pipeline
  or a running container would use, since neither has a human at a keyboard
  to click through a login flow.
- **Real environment separation** — `dev` and `prod` each get their own
  value for the one demo secret, and the machine identity is scoped to the
  project, not to a single environment's worth of ad-hoc values.

Everything here is provisioned by `bootstrap.js` against Infisical's own
REST API — the same thing you'd otherwise do by clicking through the UI,
just scripted so the whole stand comes up from nothing in one command.

## File map

| File                 | Role                                                                                                                                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker-compose.yml` | Infra only — starts Infisical's app + its own Postgres + Redis.                                                                                                                                                                               |
| `admin-api.js`       | Low-level HTTP client + admin-login helper. Not run directly — `bootstrap.js` imports it.                                                                                                                                                     |
| `bootstrap.js`       | **One-time provisioning.** Creates the org/project/environments, seeds the _first_ value of `DEMO_SECRET`, creates the machine identity + Universal Auth. Idempotent — reruns fill in only what's missing, never overwrite an existing value. |
| `up.sh`              | Orchestration: start containers, wait for the API, run `bootstrap.js`. Run once to stand the whole thing up.                                                                                                                                  |
| `run.sh`             | **The consumer side.** Authenticates as the machine identity and runs your command with secrets injected into its `process.env`. This is how the app actually gets the values.                                                                |
| `demo.js`            | Proves the `infisical run` path — prints `DEMO_SECRET` if it's in `process.env`, says plainly if it isn't.                                                                                                                                    |
| `demo-sdk.js`        | Proves the SDK path — the code itself calls the store directly, no CLI wrapper, no env injection.                                                                                                                                             |
| `down.sh`            | Tear down containers + volume + `.secrets/`.                                                                                                                                                                                                  |

## Prerequisites

```bash
npm i -g @infisical/cli
```

## 1. Bring up and populate the stand

```bash
cd infisical
bash up.sh
```

First run on a clean machine pulls the Infisical image (~2.3 GB) — do this
before you want to actually play with it, not while waiting on it.

`up.sh` is a wrapper around one real command — worth seeing directly rather
than treating it as a black box:

```bash
cd infisical
docker compose up -d --wait   # what up.sh actually runs to launch the container
```

That starts three containers (`docker-compose.yml`): Infisical's own
`db` (Postgres) and `redis`, and the `app` container itself, which is the
one you actually talk to — image `infisical/infisical:v0.162.19`, published
at `127.0.0.1:8090` (mapped from its internal port `8080`). `--wait` blocks
until all three pass their healthchecks, so the command only returns once
the API is genuinely ready, not just "container started."

Useful commands once it's up:

```bash
docker compose ps                 # see all three containers and their health
docker compose logs -f app        # tail the Infisical app's own logs
open http://localhost:8090        # the web UI, once containers are healthy
```

`up.sh` adds two things on top of that raw `docker compose up`: it polls
`http://localhost:8090/api/status` in a loop first (belt-and-suspenders on
top of `--wait`), then runs `bootstrap.js`, which:

1. Bootstraps the instance (first admin + organization).
2. Creates the `nodejspro-ecom` project (with `dev`/`staging`/`prod`
   environments).
3. Writes `DEMO_SECRET` into `dev` and `prod`, each with its own generated
   value — never a literal in this repo.
4. Creates a machine identity (`nodejspro-ecom-app`), enables Universal Auth
   on it, and grants it `viewer` access to the project.
5. Writes `.secrets/machine-identity.env` (the `clientId`/`clientSecret` pair
   — gitignored, and the only thing the app ever needs to know about the
   store) and `.secrets/admin.json` (so a rerun can log back in as the same
   admin instead of failing).

Rerunning `up.sh`/`bootstrap.js` is safe — it skips anything that already
exists rather than recreating or rotating it.

## 2. Run the demo, authenticated as the machine

```bash
node demo.js                        # ✗ undefined — nothing on disk, no identity involved
bash run.sh dev  node demo.js       # ✓ dev's value, fetched via the machine identity
bash run.sh prod node demo.js       # ✓ prod's DIFFERENT value, same code, same identity
```

`run.sh` does the two steps a real deployment would do: exchange the
`clientId`/`clientSecret` for a short-lived token (`infisical login
--method=universal-auth`), then run your command with `infisical run`, which
injects secrets into that one child process's environment only. Check
exactly what landed there:

```bash
bash run.sh dev env | grep DEMO_SECRET
```

Confirm nothing touched disk:

```bash
grep -r DEMO_SECRET . --exclude-dir=node_modules --exclude-dir=.secrets   # nothing
```

## 3. Or: fetch it directly from app code, no env injection at all

`run.sh`/`infisical run` is one integration style — a CLI wrapper puts
secrets into a child process's env before it starts. The other real style is
the **SDK**: your own code calls the store directly, whenever it wants,
using the exact same machine identity credentials.

```bash
node demo-sdk.js dev
node demo-sdk.js prod
```

`demo-sdk.js` reads the same `.secrets/machine-identity.env` `run.sh` uses,
authenticates with `@infisical/sdk`'s Universal Auth login, then calls
`client.secrets().getSecret({ environment, projectId, secretName })` and
prints whatever comes back — no `infisical run`, no env var ever set.

This is also the pattern that actually enables live rotation, unlike plain
`infisical run` (which is a snapshot at exec time — see the note below).
Since `getSecret()` is a normal async call, calling it fresh on every use
— exactly like the `pg.Pool` password function from point 4 — means a
value edited in the UI/CLI takes effect on the _next_ call, no restart and
no `--watch` needed:

```bash
node demo-sdk.js dev   # note the value
# edit DEMO_SECRET for dev via the UI or CLI (see the next section)
node demo-sdk.js dev   # new value, same process would see it too if it called getSecret() again
```

## 4. Managing secrets without touching `bootstrap.js`

`bootstrap.js` is provisioning, not a day-to-day editing tool — the machine
identity it creates only gets `viewer` access on purpose, so nothing
automated can quietly rewrite a value. Adding, editing, or deleting a secret
is a **human** action, done one of two ways:

**Web UI** — simplest. Open `http://localhost:8090`, log in with the admin
credentials from `.secrets/admin.json` (written by `bootstrap.js`), open the
project → environment, click a secret to edit it or add a new one.

**CLI, logged in as yourself** (a separate auth path from the machine
identity `run.sh` uses):

```bash
infisical login --domain=http://localhost:8090   # human login, browser flow

PROJECT_ID=$(node -p "require('./.secrets/stand.json').projectId")

infisical secrets set    NEW_KEY="value" --env=dev  --projectId="$PROJECT_ID" --domain=http://localhost:8090
infisical secrets get    DEMO_SECRET     --env=prod --projectId="$PROJECT_ID" --domain=http://localhost:8090
infisical secrets delete OLD_KEY         --env=dev  --projectId="$PROJECT_ID" --domain=http://localhost:8090
```

`.secrets/stand.json` (also written by `bootstrap.js`) is where the project
id lives, so you never have to hunt for it in the UI.

To see a rotation take effect, edit the value one of the ways above, then:

```bash
bash run.sh dev node demo.js        # ✓ new value
```

Note the honest limit here, same one the lecture calls out: this is a
snapshot at `exec` time, not a live update. A long-running process started
with `infisical run` keeps whatever value it got at startup — noticing a
rotation needs `--watch` (auto-restart on change), which is a restart, just
an automatic one. True zero-downtime rotation is what point 4's file-based
mechanism already gives you; this bonus demonstrates a different, simpler
guarantee ("never on disk, fetched by an authenticated machine"), not a
better version of the same guarantee.

## 5. Tear down

```bash
bash down.sh
```

Removes the containers, the volume, and `.secrets/` — the machine
identity's `clientSecret` is shown exactly once by the API, so once this
stand is gone there's no recovering it. A fresh `up.sh` mints new ones.
