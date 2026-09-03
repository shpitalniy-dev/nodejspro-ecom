## Getting Started

Start the app in development mode:

```bash
docker compose up
```

Run the test suite inside a container:

```bash
docker compose run --rm api npm test
```

Build and start the production image:

```bash
docker compose -f docker-compose.yml up -d --wait
```

## Shortcuts

A `Makefile` wraps the commands above:

```bash
make dev-build   # docker compose build
make dev-up      # docker compose up
make dev-down    # docker compose down
make prod-build  # docker compose -f docker-compose.yml build
make prod-up     # docker compose -f docker-compose.yml up -d
make prod-down   # docker compose -f docker-compose.yml down
make status      # docker compose ps
make test        # docker compose run --rm api npm test
```

## OpenAPI Contract | HW #9

The API contract lives in [`openapi/openapi.yaml`](openapi/openapi.yaml).

Lint the spec (errors must be 0; warnings are allowed):

```bash
npx @redocly/cli@2.46.0 lint openapi/openapi.yaml
```

Bundle it and check resource/operation counts plus the `Idempotency-Key`
parameter (expects: operations ≥ 5, resources ≥ 2, required = true, description
≥ 40 characters):

```bash
npx @redocly/cli@2.46.0 bundle openapi/openapi.yaml -o spec.json

node -e "const s=require('./spec.json'),M=['get','post','put','patch','delete'];\
const ops=Object.entries(s.paths).flatMap(([p,v])=>Object.keys(v).filter(m=>M.includes(m)).map(m=>[p,m]));\
const idem=ops.flatMap(([p,m])=>s.paths[p][m].parameters??[]).find(x=>x.in==='header'&&/idempotency-key/i.test(x.name));\
console.log('операцій:',ops.length,'· ресурсів:',new Set(Object.keys(s.paths).map(p=>p.split('/')[1])).size);\
console.log('Idempotency-Key: required =',idem?.required,'· опис, символів =',(idem?.description??'').trim().length)"
```

Check cursor pagination and the `Idempotency-Key`/`problem+json` contracts are
declared (expects: `next_cursor` ≥ 1, `Idempotency-Key` ≥ 1,
`application/problem+json` ≥ 2):

```bash
grep -c 'next_cursor' openapi/openapi.yaml
grep -c 'Idempotency-Key' openapi/openapi.yaml
grep -c 'application/problem+json' openapi/openapi.yaml
```

### Visualize the spec

Render it as a static HTML doc (Redoc) and open `openapi/docs.html`:

```bash
npx @redocly/cli@2.46.0 build-docs openapi/openapi.yaml -o openapi/docs.html
```

## Contract Enforcement | Variant Б

Chosen variant: **Б — runtime validation**. A NestJS app (`src/`) with
`express-openapi-validator` mounted in front of it, reading
`openapi/openapi.yaml` directly (`validateRequests` + `validateResponses`).
Request shape, the required `Idempotency-Key` header, and outgoing response
shapes are all enforced by the spec — nothing about them is checked by
hand-written `if`s in the code.

### Run

```bash
npm install
npm run build
npm start
```

The server listens on `PORT` (default `3000`).

### Verify — `contract/check.js`

A machine check, modeled on Lecture 9's own `contract/check.mjs`: it reads
`openapi/openapi.yaml` directly (no live `/docs-json` route here, since
Swagger isn't wired in), fires one real request per operation at the
**running** server, and validates each response — status, content-type,
required response headers, and body — with Ajv against what the spec
actually declares.

Needs the server running in a separate terminal first:

```bash
# terminal 1
npm run build && npm start
```

```bash
# terminal 2 — exits 0 only if every check is green
npm run contract
```

## Configuration | HW #11

Config is a single zod schema (`src/config/env.schema.ts`), validated once at
startup via `ConfigModule.forRoot({ validate })` — a broken or missing
variable means the process refuses to start, not a 500 on the first request.
There are no direct `process.env` reads anywhere else in the codebase; every
read goes through the typed `ConfigService<Env, true>`.

### Environment variables

| Variable           | Default                    | Required | Description                                                                                         |
| ------------------ | -------------------------- | :------: | --------------------------------------------------------------------------------------------------- |
| `PORT`             | —                          |    ✅    | HTTP port the server listens on.                                                                    |
| `LOG_LEVEL`        | `info`                     |          | One of `debug`, `info`, `warn`, `error`.                                                            |
| `TIMEOUT_MS`       | `5000`                     |          | Timeout budget for outbound calls, in ms.                                                           |
| `DB_HOST`          | `postgres`                 |          | Postgres host — the compose service name, resolved via Docker DNS.                                  |
| `DB_PORT`          | `5432`                     |          | Postgres port.                                                                                      |
| `DB_NAME`          | `ecom`                     |          | Database name.                                                                                      |
| `DB_USER`          | `app_user`                 |          | Postgres role the app connects as (created by `db/init.sql`).                                       |
| `DB_PASSWORD_FILE` | `/run/secrets/db_password` |          | Path to the file holding the _current_ DB password (where Compose mounts the `db_password` secret). |
| `DB_URL`           | —                          |    ✅    | Full connection string. Not read by the app itself — see below.                                     |

The DB password itself is **never** an env var for the app's own
connection — see [Rotate the DB
password](#rotate-the-db-password-without-restarting) below for why.

`DB_URL` is the one exception, and it's deliberately not wired into
`DatabaseService`: a single connection string bakes the password in as a
frozen value, which can't survive `rotate.sh` changing it without a
restart. It exists for external tools that expect the standard
`postgres://user:password@host:port/db` shape — a `psql "$DB_URL"`
one-liner, a future ORM CLI running migrations — not for the running app,
so it authenticates as `admin`, not `app_user`: migrations need `CREATE`
rights `app_user` doesn't have (see [Connect](#connect) under Data Layer —
same reasoning as running `db/schema.sql` as `admin`). `.env.example`
carries a fake password, same as every other secret-shaped value there.

`.env.example` is the checked-in contract: every schema variable is listed
there (secrets get fake placeholders). The real `.env` is git-ignored.
Keep them in sync — `npm run check:env` fails with exit 1 the moment they
drift:

```bash
npm run check:env
```

### Run

```bash
cp .env.example .env
mkdir -p secrets && printf '%s' 'postgres_app_password' > secrets/db_password
npm install
make dev-up   # docker compose up --build -V — starts api + postgres
```

`secrets/db_password` is git-ignored and doesn't exist on a fresh clone —
Compose's `db_password` secret reads it from that path on the host and
mounts it into the container at `/run/secrets/db_password`, so without it
the first request touching the database fails outright. The value above
(`postgres_app_password`) has to match `database/init.sql`'s bootstrap
password, since that's what Postgres actually creates `app_user` with on a
fresh volume.

On the very first boot, Postgres has an empty data volume, so
`db/init.sql` runs once and creates the `app_user` role. On every
later boot that volume already has data, so Postgres skips init scripts
entirely — if you ever reset the DB with `docker compose down -v`, the role
comes back with `init.sql`'s starting password, so `secrets/db_password`
must be reset to match it (see the file for the exact value) or the app's
first connection fails.

Verify fail-fast works — a missing required variable kills the process with
a clear reason and a non-zero exit code, instead of dying on the first
request in prod:

```bash
mv .env /tmp/env.bak
env -u PORT npm run start   # ✗ PORT: Invalid input… — exit code ≠ 0
mv /tmp/env.bak .env
```

### Rotate the DB password without restarting

The password lives in `secrets/db_password` on the host (git-ignored),
which Compose mounts into the `api` container at `/run/secrets/db_password`
— the actual path `DB_PASSWORD_FILE` points at. `pg.Pool`'s `password`
option is a
**function** that re-reads that file on every new connection — not a string
frozen at startup. Rotating it doesn't touch the running process at all.

```bash
bash rotate.sh
```

In order (the order matters — see comments in the script):

1. `ALTER ROLE app_user WITH PASSWORD '…'` — the new password becomes true in Postgres.
2. Overwrite `secrets/db_password` — any _new_ pool connection now picks it up.
3. `pg_terminate_backend` on `app_user`'s existing connections — forces the pool to open fresh ones, which pick up the file from step 2.

To see it happen without a restart:

```bash
curl -s localhost:3000/health/db      # note the uptime
bash rotate.sh
curl -s localhost:3000/health/db   # → 200, connects with the *new* password
curl -s localhost:3000/health/db      # uptime is higher — same process, never restarted
```

## Data Layer | HW #12

Schema, seed, and index-tuning for the data layer, proven against real
volume instead of an empty dev database. Full before/after
`EXPLAIN (ANALYZE, BUFFERS)` output and reasoning for each query lives in
[`db/OPTIMIZATIONS.md`](db/OPTIMIZATIONS.md).

**Head table: `orders`** — 200,000 rows after seeding; that's the table the
row-count and Seq Scan / Index Scan checks below run against.

| File                                    | Purpose                                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `db/schema.sql`                         | Tables + constraints — `users`, `products`, `orders`, `order_items`, 3 foreign keys                                    |
| `db/seed.sql`                           | Realistic, skewed volume via `generate_series`; ends in `VACUUM (ANALYZE);`, not bare `ANALYZE;`                       |
| `db/queries/q1.sql`, `q2.sql`, `q3.sql` | One real query per file, one statement each                                                                            |
| `db/indexes.sql`                        | The minimal index set that fixes all three queries — includes a partial and an expression index                        |
| `db/explain.sh`                         | Runs `EXPLAIN (ANALYZE, BUFFERS)` for all three queries — same script, run once before `db/indexes.sql` and once after |
| `db/OPTIMIZATIONS.md`                   | Before/after `EXPLAIN (ANALYZE, BUFFERS)` per query, with what changed and why                                         |

### Bring up Postgres

```bash
docker compose up -d --wait postgres
```

Scoped to `postgres` alone on purpose: the `api` service needs `.env` and
`secrets/db_password`, and neither exists on a fresh clone — that's the
app's runtime credential from [Configuration](#configuration--hw-11),
gitignored by design. Postgres itself boots on the dev credentials already
inline in `docker-compose.yml` (`admin` / `admin-bootstrap-password`), so
this line needs nothing copied or edited first.

### Connect

```bash
docker compose exec -T postgres psql -U admin -d ecom
```

Everything below runs as `admin`, not `app_user` — `app_user` only has
`CONNECT` on the database (see `db/init.sql`), by design: it's the app's
least-privilege runtime credential, not a role meant to run DDL or bulk
seeding.

### Run the full pipeline

```bash
# 1. schema
docker compose exec -T postgres psql -U admin -d ecom < db/schema.sql

# 2. seed — 200k orders, skewed distributions, ends in VACUUM (ANALYZE)
docker compose exec -T postgres psql -U admin -d ecom < db/seed.sql

# 3. "before" — each of the three should show a Seq Scan
bash db/explain.sh

# 4. indexes, then refresh planner stats
docker compose exec -T postgres psql -U admin -d ecom < db/indexes.sql
docker compose exec -T postgres psql -U admin -d ecom -c "ANALYZE;"

# 5. "after" — same three queries, no Seq Scan left
bash db/explain.sh
```

### Self-check before submitting

The same clean-volume cycle the grader runs — worth confirming yourself
rather than assuming it works:

```bash
docker compose down -v
docker compose up -d --wait postgres

docker compose exec -T postgres psql -U admin -d ecom -Atc "SELECT 1"
  # expect 1 — the fresh-clone check

docker compose exec -T postgres psql -U admin -d ecom < db/schema.sql
docker compose exec -T postgres psql -U admin -d ecom -Atc \
  "SELECT count(*) FROM information_schema.table_constraints WHERE constraint_type='FOREIGN KEY' AND table_schema='public';"
  # expect ≥ 3

docker compose exec -T postgres psql -U admin -d ecom < db/seed.sql
docker compose exec -T postgres psql -U admin -d ecom -Atc "SELECT count(*) FROM orders;"
  # expect ≥ 100000

docker compose exec -T postgres psql -U admin -d ecom < db/indexes.sql
docker compose exec -T postgres psql -U admin -d ecom -c "ANALYZE;"
docker compose exec -T postgres psql -U admin -d ecom -Atc \
  "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND (indexdef ILIKE '% WHERE %' OR indexdef ~ '\((\w+)\(');"
  # expect ≥ 1 (the partial + expression indexes)

bash db/explain.sh   # actually run q1-q3 so idx_scan reflects real usage

docker compose exec -T postgres psql -U admin -d ecom -Atc \
  "SELECT indexrelname, idx_scan FROM pg_stat_user_indexes WHERE idx_scan = 0;"
```
