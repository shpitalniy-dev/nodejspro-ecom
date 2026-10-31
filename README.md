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

## Architecture Note | Course Project

The first chapter of the course project, not a separate assignment. This
describes the domain and architecture for the full 17-HW arc — a plan for
what gets built. Decisions here don't get rewritten as the build progresses;
new ones get appended to the log at the bottom instead.

### 1. What this service is

**Ecommerce API** — an online store: customers browse and buy from the
catalog, admins manage the catalog and fulfil orders.

**Customer**

- Browse available products.
- Place an order for one or more products.
- View order history, including each order's payment and fulfillment
  status.

**Admin**

- Manage the product catalog, including stock levels.
- Process an order's fulfillment once it's paid.

### 2. Domain

Six entities:

- **`users`** — customers and admins, distinguished by `role`.
- **`products`** — the catalog.
- **`inventory`** — one row per product, tracking `quantity` on hand.
  Kept separate from `products` rather than a `stock` column there, so
  every order updates `inventory` and the catalog itself stays purely
  read-heavy — protecting HW#23's caching story instead of undermining it
  the moment real order traffic exists.
- **`orders`** — one per customer purchase, carrying a payment status:
  `unpaid → paid → refunded`. `amount_cents`/`discount_cents` are computed
  and stored at creation time based on whatever discount conditions
  applied then (coupon, bulk quantity, etc.) — not derived by summing
  `order_items`, so a later change to a discount rule or a product's price
  can't rewrite what a past order actually charged.
- **`order_items`** — line items within an order, snapshotting the
  product's price/currency at purchase time so a later price change can't
  rewrite history.
- **`fulfillments`** — one per order, created the moment that order's
  payment status becomes `paid`, carrying its own status:
  `pending → processing → shipped → delivered`.

Relationships: `users` 1—N `orders`; `orders` 1—N `order_items`;
`orders` 1—1 `fulfillments`; `products` 1—N `order_items`;
`products` 1—1 `inventory`.

#### Domain check

| ✔  | Requirement                      | How it's met                                                                                                    | Delivered by                             |
| --- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| ✅  | ≥ 2 user roles, different rights | `users.role` (`user`/`admin`)                                                                                   | HW#24                                    |
| ✅  | Contested resource               | `inventory.quantity`, decremented on order creation                                                             | HW#14                                    |
| ✅  | Irreversible-effect operation    | Payment capture — an order's status moves to `paid`, creating a `fulfillments` row                              | HW#12 ✓ schema · HW#22 outbox            |
| ✅  | Event needing notification       | Fulfillment status change (`shipped`, `delivered`) notifies the customer                                        | HW#18 realtime · HW#19 queue             |
| ✅  | Entity with files                | Product images                                                                                                  | HW#26                                    |
| ✅  | Read-heavy, rarely-changed data  | The product catalog                                                                                             | HW#12 ✓ schema · HW#23 cache             |
| ✅  | 4-6 entities + a heavy query     | `users`, `products`, `orders`, `order_items` (EXPLAIN-proven at 200k rows), plus `fulfillments` and `inventory` | HW#12 ✓ · fulfillments/inventory planned |

7/7. Three rows carry a `✓` because their schema and proof already shipped
in HW#12; the rest land with the HW that actually needs them.

### 3. Architectural decisions

- **Compute model** — a single stateless Node.js/NestJS container (`api`
  service). No serverless split; nothing about expected traffic justifies
  one.
- **Database** — a single Postgres instance (`postgres` service), no read
  replicas. Proven at real volume in HW#12: a 200,000-row `orders` table,
  indexed and EXPLAIN-verified, not just tested against an empty dev DB.
- **Asynchrony** — synchronous request/response for now; a queue/event bus
  arrives with HW#18 (realtime), #19 (queue), and #22 (outbox) — exactly
  where fulfillment-status notifications and payment idempotency live.
- **Auth** — arrives with HW#24, once `users.role` exists to authorize
  against.
- **Deploy** — Docker Compose, single host (`docker-compose.yml` for prod,
  `docker-compose.override.yml` for dev). No orchestrator planned.

### 4. Trade-offs

- **Auth lands at HW#24, not sooner** — building it before the contract,
  config, and data-layer work (HW#9-#12) was solid would mean redoing
  auth-gated tests every time those changed underneath it.
- **No queue/event bus before HW#18/#19** — a `fulfillments` table with
  nothing creating or consuming its rows yet is just dead state; the table
  and the mechanism that populates/reacts to it arrive together.
- **`inventory` arrives at HW#14, not earlier** — that HW is explicitly
  about transactions under concurrent load. A decrement built before
  covering isolation levels and locking would be a naive version HW#14
  would just replace.
- **Connection pooling and backups aren't tuned yet** — HW#15 covers this
  specifically; tuning ahead of the lecture that's supposed to inform it
  would be guessing.
- **`openapi/openapi.yaml` only describes what's implemented** —
  `express-openapi-validator` enforces that spec against every real
  request and response at runtime. Adding `role`, `inventory`, or
  `fulfillments` to it before the feature exists would make the contract
  aspirational instead of enforced, which is exactly what HW#9's design
  was built to avoid.

### Logs

- **2026-09-06** — Settled the domain shape before touching the schema:
  `users.role` (`user`/`admin`) for RBAC; an order payment lifecycle of
  `unpaid → paid → refunded`; a separate `fulfillments` table, one row per
  order, created when it's paid; a separate `inventory` table, one row per
  product, keeping `products` itself purely read-heavy.

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
one-liner, [the ORM CLI](#orm-layer--hw-13) — not for the running app,
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

## ORM Layer | HW #13

TypeORM entities, migrations, seed, and a report over the HW#12 schema —
`db/schema.sql` isn't replaced, it stays exactly as-is for HW#12's own
`EXPLAIN` pipeline above. This is a second, equivalent path to the same
schema: entities are hand-written to mirror `db/schema.sql`, and the one
migration below creates the same tables/constraints from scratch, with two
documented exceptions noted where they come up.

| File                      | Purpose                                                               |
| ------------------------- | --------------------------------------------------------------------- |
| `src/entities/`           | One class per table, hand-mapped to `db/schema.sql`                   |
| `src/migrations/`         | One migration, generated then hand-edited (see below)                 |
| `src/data-source.ts`      | `DataSource`, `synchronize: false` — config only from `process.env`   |
| `src/seed.ts`             | Deterministic, idempotent fixture data                                |
| `src/demo-nplus1.ts`      | N+1, measured, on `orders -> order_items -> products`                 |
| `src/report.ts`           | One aggregate report via `createQueryBuilder().getRawMany()`          |
| `scripts/with-secrets.sh` | Wraps every DB-touching script; `DB_URL` from Infisical or the grader |

### Entities

Explicit snake_case `name:` on every column — no naming-strategy package,
so the mapping is visible in each file rather than implied by convention.
Money columns (`price_cents`, `amount_cents`, `discount_cents`) are `bigint`
in Postgres and typed `string` in TypeScript: `pg` returns `bigint` as a
string to avoid silent precision loss past `Number.MAX_SAFE_INTEGER` — the
same reasoning HW#12 already had for widening these columns off `int4`.
`id` is `GENERATED ALWAYS AS IDENTITY`, matching `db/schema.sql` exactly.

Every relation property is wrapped in `Relation<T>`
(`product!: Relation<Product>`, `orders?: Relation<Order[]>`, …) — not
style. The entities reference each other on both sides of every relation
(`Order.items` <-> `OrderItem.order`), and `emitDecoratorMetadata` emits a
direct class reference for an unwrapped relation type, which crashes at
runtime in this ESM project (`Cannot access 'X' before initialization` —
a temporal-dead-zone error from the import cycle). `Relation<T>` is
TypeORM's own fix: it makes the emitted metadata `Object` instead of the
class, so the cycle stays lazy. The import cycles themselves are real but
benign (resolved lazily via each relation's `() => Entity` thunk) —
`import/no-cycle` is scoped off for `src/entities/` accordingly.

`order_items` is the join-entity for the genuinely many-to-many
orders<->products relationship — it carries data on the edge (`quantity`,
a price/currency/key snapshot at purchase time), so it's a real entity with
two `@ManyToOne`s, never `@ManyToMany`.

### Relations & onDelete

| Relation                        | FK column             | `onDelete` | Why                                                             |
| ------------------------------- | --------------------- | :--------: | --------------------------------------------------------------- |
| `Inventory.product` → `Product` | `product_id` (UNIQUE) | `CASCADE`  | Inventory is a product's own attribute — gone if the product is |
| `OrderItem.product` → `Product` | `product_id`          | `RESTRICT` | Order history must survive a product going away                 |
| `OrderItem.order` → `Order`     | `order_id`            | `RESTRICT` | Same — items are the history                                    |
| `Order.user` → `User`           | `user_id`             | `RESTRICT` | An order must survive its buyer being removed                   |
| `Fulfillment.order` → `Order`   | `order_id` (UNIQUE)   | `RESTRICT` | A fulfillment record outlives interest in deleting its order    |

```bash
grep -rn "onDelete" src/
#   order-item.entity.ts:50   onDelete: 'RESTRICT'
#   order-item.entity.ts:57   onDelete: 'RESTRICT'
#   inventory.entity.ts:38    onDelete: 'CASCADE'
#   order.entity.ts:56        onDelete: 'RESTRICT'
#   fulfillment.entity.ts:46  onDelete: 'RESTRICT'
```

### Migrations

`synchronize: false` in `data-source.ts` — schema changes only ever happen
through a migration, never inferred from entities at runtime.

The one migration (`src/migrations/*-InitialSchema.ts`) was generated with
`typeorm migration:generate` against an empty database, then hand-edited
for the two things entity metadata can't express:

1. `CREATE UNIQUE INDEX users_email_lower_key ON users (LOWER(email))` —
   TypeORM has no expression-index decorator.
2. The `set_updated_at()` trigger function + one `BEFORE UPDATE` trigger
   per table — `updated_at` is DB-managed, stamped on every real update
   regardless of who issues it, and stays `NULL` until then. `down()`
   reverses both, in dependency order, before the generated drops.

One deliberate divergence from `db/schema.sql`: `currency` is `text` +
`CHECK (currency IN ('USD'))` in the migration, where `db/schema.sql` uses
the `currency_code` DOMAIN. Equivalent enforcement — chosen so
`migration:generate` doesn't perpetually flag a domain it can't introspect
as a pending change.

```bash
docker compose up -d --wait
npm run build
npm run migrate         # creates the schema from scratch
npm run migrate:show    # [X] InitialSchema...
npm run migrate:revert  # drops it again — down() is a real implementation
npm run migrate         # back to the same schema
```

### Seed

`src/seed.ts` — deterministic fixtures (fixed UUIDs/keys/prices, no
`random()`), idempotent via `ON CONFLICT DO NOTHING` on each table's
natural key (`products.key`, `users.uuid`, `orders.uuid`,
`inventory.product_id`, `fulfillments.order_id`). `order_items` has no
natural key of its own, so it's only inserted for orders that were
actually new on that run — piggybacking on `orders`' own conflict check
rather than needing one of its own.

```bash
npm run seed && npm run seed   # second run: no errors, 0 rows added
```

```bash
psql "$DB_URL" -c "SELECT
  (SELECT count(*) FROM users)        AS users,
  (SELECT count(*) FROM products)     AS products,
  (SELECT count(*) FROM inventory)    AS inventory,
  (SELECT count(*) FROM orders)       AS orders,
  (SELECT count(*) FROM order_items)  AS order_items,
  (SELECT count(*) FROM fulfillments) AS fulfillments;"
# 8 | 10 | 10 | 8 | 13 | 3 — identical before and after the second run
```

### N+1 — naive vs. `relations` vs. `relationLoadStrategy`

Measured on the real graph, `orders -> order_items -> products`, at two
collection sizes (`N = 3` and `N = 8`, the full seed) to prove the fixed
strategies are flat, not just smaller:

| Strategy                               | N=3 | N=8 |
| -------------------------------------- | :-: | :-: |
| naive (query per element, both levels) |  9  | 22  |
| `relations` (join, default)            |  2  |  2  |
| `relationLoadStrategy: 'query'`        |  5  |  5  |

Naive is `1 + N + M` (orders, then one items-query per order, then one
products-query per item) — it visibly scales with the collection.
Both fixes are exactly flat across `N=3 -> N=8`, which is the actual proof,
not just a smaller number at one size.

Two results worth explaining rather than rounding off:

- **`relations` measured 2, not 1.** `take` (pagination) meets a to-many
  join: Postgres can't apply `LIMIT` directly on a joined result (the join
  multiplies rows per order), so TypeORM runs a `SELECT DISTINCT` id-picking
  subquery first, then the real joined fetch. Drop `take` and it's a
  genuine 1 query — kept here because a real list endpoint is paginated.
- **`relationLoadStrategy: 'query'` measured 5**, matching `1 + 2×levels`
  for 2 levels exactly: the orders query, a batched `order_items WHERE
order_id IN (...)`, a batched `products WHERE id IN (...)`, plus two
  relation-id mapping queries TypeORM issues to stitch the results back
  together (one per relation edge).

```bash
npm run demo:nplus1
```

### Report — Repository vs. QueryBuilder

`src/report.ts` computes revenue by product, counting only `paid` orders
(unpaid/pending haven't been paid; refunded had the money returned) —
an aggregate across a join that `find()` has no vocabulary for at all, so
it's `createQueryBuilder().getRawMany()`:

```bash
npm run report
```

```
revenue by product (paid orders only)
  sku-doohickey      2 units       $250.00   (1 line item)
  sku-apparatus      1 unit        $230.00   (1 line item)
  sku-contraption    2 units       $176.00   (1 line item)
  ...
```

`SUM`/`COUNT` come back from `pg` as strings too, same reasoning as the
`bigint` columns above — `revenueCents`, `unitsSold`, `lineItems` are all
converted only at display time.

**Repository vs. QueryBuilder, the rule this project follows:** Repository
(`find()`, relations, `save()`) for anything that maps onto an entity —
CRUD, relation loading, filtering by columns. `createQueryBuilder()` only
when the result isn't shaped like an entity at all — an aggregate or a raw
cross-join projection `find()` structurally can't produce. Domain-shaped
result → Repository; report-shaped result → QueryBuilder.

### Connection — via Infisical

Every value in `data-source.ts` comes from `process.env.DB_URL` — no
hardcoded host or password, no separate env file read:

```bash
grep -nE "password:['\"]" src/data-source.ts   # empty
```

`DB_URL` carries `admin` credentials on purpose: migrations, seed, and the
report all need `CREATE`/broad rights `app_user` doesn't have. It's
populated by `scripts/with-secrets.sh`, which wraps every DB-touching
script (`migrate*`, `seed`, `demo:nplus1`, `report`):

```bash
bash scripts/with-secrets.sh dev npm run migrate
```

logs into Infisical with a read-only machine identity and runs the command
through `infisical run --env=dev`. The grader has no vault access, so it
sets `SKIP_VAULT=1` and exports `DB_URL` itself — the wrapper execs the
command directly, no Infisical call at all, right after the `ENV_SLUG` is
split off the arguments and before anything vault-related happens:

```bash
node -e "const s=require('./package.json').scripts;const bad=['migrate','seed']
  .filter(k=>/with-secrets\.sh/.test(s[k]||'')===false);
  console.log(bad.length===0?'OK':'без обгортки: '+bad.join(', '));
  process.exit(bad.length===0?0:1)"
```

## Конкурентність | HW #14

The main test of the HW#13 data layer: what happens when the checkout
endpoint gets hit 50 times at once. `checkout()` decrements balance and
stock, records the order, and queues its post-processing task — all in one
transaction, or none of it — and survives real concurrent load without
oversell or lost updates. One new migration (`users.balance_cents`, plus a
generic `tasks` queue table — no FK to `orders` on purpose, see
`task.entity.ts`); everything else below is new application code, not
schema.

| File                                      | Purpose                                               |
| ----------------------------------------- | ----------------------------------------------------- |
| `src/transactions/checkout.ts`            | The transactional operation itself                    |
| `src/transactions/with-retry.ts`          | Generic retry wrapper — catches only `40001`/`40P01`  |
| `src/transactions/demo-race.ts`           | 50 concurrent checkouts, one product, no oversell     |
| `src/transactions/demo-workers.ts`        | Worker pool draining the task queue via `SKIP LOCKED` |
| `src/transactions/demo-retry.ts`          | Two provoked serialization failures, both recovered   |
| `src/migrations/...AddBalanceAndTasks.ts` | `users.balance_cents` + the `tasks` table             |

### Checkout — atomic UPDATE vs. pessimistic lock

Both the balance and the stock decrement are a single
`UPDATE ... SET x = x - $n WHERE ... AND x >= $n RETURNING x`, not a
`SELECT` followed by a `FOR UPDATE`-protected write. The reasoning: there's
no separate read step for a concurrent checkout to race into in the first
place — the check and the mutation are the same statement — so plain
`READ COMMITTED` (the default) is already correct, with no retry loop
needed. `FOR UPDATE` earns its cost when the decision logic is too complex
to express in one `WHERE`/`SET`; a flat "enough left, and take it" isn't.

Two things worth documenting because they weren't obvious until verified
against real behavior:

- **`manager.query()` on an `UPDATE`/`DELETE` always returns
  `[rows, rowCount]`, never a plain array — even with `RETURNING`.**
  Confirmed directly in TypeORM's `PostgresQueryRunner.query()`, which
  special-cases `UPDATE`/`DELETE` to `raw = [raw.rows, raw.rowCount]`; a
  bare array only happens for a `SELECT`-shaped command. The first version
  of `checkout()` checked `.length` on the un-destructured result — which
  checks the _tuple's_ length (always `2`) — so the out-of-stock and
  insufficient-funds guards never fired at all, and every checkout silently
  "succeeded" regardless of real stock/balance. Fixed by destructuring
  `const [rows] = await manager.query(...)` before checking `rows.length`.
- **The post-processing task's `available_at` is computed by Postgres
  (`now() + interval '2 hours'`), not `new Date(Date.now() + ms)` in the
  app.** The whole operation already runs inside one DB transaction, so
  there's no reason this scheduling decision should depend on the app
  server's clock agreeing with the database's — the worker that later
  checks `available_at <= now()` is asking the same clock that set it.

### `demo:race`

```bash
npm run demo:race
```

```
attempts:            50
succeeded:           10
out of stock:        40
unexpected errors:   0
final stock:         0
negative-stock rows: 0
```

50 concurrent `checkout()` calls (`Promise.allSettled`, not the
assignment's literal `Promise.all` — `Promise.all` aborts the whole batch
on the first rejection, and ~40 of these 50 calls are _expected_ to reject
once stock hits zero; `Promise.allSettled` keeps the "fire all 50 at once,
no app-level queue" property while still collecting every outcome).
Reproducible every run: exactly 10 successes (the seeded stock), the rest
correctly rejected with `OutOfStockError`, zero unexpected errors.

The negative-stock check turned out to be backed by more than application
logic: `inventory.quantity` has a real `CHECK (quantity >= 0)` constraint.
Tried to violate it directly with `psql` to test the check itself, and
Postgres refused the `UPDATE` outright — oversell is structurally
impossible here independent of whether `checkout()`'s own logic is right.

### `demo:workers`

```bash
npm run demo:workers
```

```
distribution (claimed / recorded in DB):
  worker-1   5 / 5
  worker-2   5 / 5
  worker-3   5 / 5
  worker-4   5 / 5

processed twice:   0
done:              20 / 20
delayed task:      status=pending processed=0 (expected pending/0)
elapsed:           936ms (sequential estimate: 3000ms)
```

4 workers, `FOR UPDATE SKIP LOCKED` via TypeORM's own QueryBuilder API
(`setLock('pessimistic_write')` + `setOnLocked('skip_locked')`) — a
deliberate mirror of `checkout.ts`'s raw SQL, so the submission shows both
primitives rather than one style everywhere. One task in the batch is
scheduled two hours out; it correctly stays `pending` the whole run,
proving `available_at` is actually enforced by the worker's query, not
just set by `checkout()`.

**A real, subtle bug worth documenting in full, the same way HW#13's N+1
findings are:** the very first version claimed with
`.setLock('pessimistic_write').setOnLocked('skip_locked').where(...).orderBy(...).getOne()`
and measured wildly uneven results — one worker claiming 12–17 of 20 tasks,
another getting 0, total time barely beating the sequential estimate
despite 4-way concurrency. Printing the actual generated SQL
(`qb.getSql()`) showed why: **`.getOne()` does not add a SQL `LIMIT`** — it
only takes the first row of the entire matching result set in JS. Combined
with row locking, that's a correctness bug, not just waste: the lock
applies to _every_ row the query matches. Whichever transaction's query ran
first locked all 20 pending rows in one shot, leaving the other three
workers nothing to claim until it committed. Adding `.limit(1)` before
`.getOne()` fixed it completely — a minimal isolation test (four bare
transactions, no claim logic) confirmed genuine 4-way parallelism was never
the problem; the missing `LIMIT` was.

### `demo:retry`

```bash
npm run demo:retry
```

```
scenario A — REPEATABLE READ: concurrent balance read-modify-write
  op +$50: retries=0   op -$30: retries=1
  final balance_cents: 102000 (expected 102000)

scenario B — SERIALIZABLE: concurrent admin self-demotion (write skew)
  alice demoted=true retries=0   bob demoted=false retries=1
  final admin count: 1 (expected 1)
```

Two scenarios, both through the same `withRetry`, proving it's
isolation-level-agnostic rather than tuned to one failure mode:

- **Scenario A (`REPEATABLE READ`)** — two concurrent read-modify-writes on
  the same `users.balance_cents` row. The loser's own `UPDATE` fails with
  `40001` (its snapshot is stale against the winner's commit); retried, the
  final balance lands exactly on `baseline + 5000 - 3000` every run.
- **Scenario B (`SERIALIZABLE`)** — write skew, the case only
  `SERIALIZABLE` catches: two admins each check "are there ≥2 admins?" and,
  if so, demote _themselves_. Neither transaction's write touches the row
  the other read, so under `REPEATABLE READ` both would silently succeed,
  leaving zero admins — a real invariant violation with no error at all.
  Confirmed the failure actually happens at `COMMIT`, not the `UPDATE` —
  Postgres's real error text is "could not serialize access due to
  read/write dependencies among transactions" — the exact RR-vs-SSI
  distinction from the lecture, verified against real Postgres output
  rather than taken on faith. The retry matters differently here than in
  Scenario A: on retry,
  the loser re-reads the admin count fresh (now `1`) and correctly
  _refuses_ to demote — retrying the whole transaction, not just the write,
  is what makes that refusal possible.

**Why the retry wrapper catches only `40001`/`40P01`:** those two codes are
Postgres's own instruction to retry the _entire_ transaction — a stale
snapshot or a broken deadlock cycle, nothing about the data itself being
wrong. Any other error (a `CHECK` violation, a foreign-key violation, a
plain bug) is a real problem that retrying would either fail identically
forever or, worse, silently paper over.

## Data layer ops | HW #15

Two production attributes added to the HW#12–14 data layer: a connection
pooler in front of Postgres, and a backup you can actually prove restores,
because you've restored it yourself.

| File                      | Purpose                                              |
| ------------------------- | ---------------------------------------------------- |
| `pgbouncer/pgbouncer.ini` | Pool config — `pool_mode = transaction`, in the repo |
| `pgbouncer/userlist.txt`  | Client auth for PgBouncer (plain password, SCRAM)    |

### PgBouncer

Every DB-touching thing — the app, `migrate`/`seed`, every `demo:*` script —
connects to `127.0.0.1:6432` (PgBouncer) now, never to Postgres's own `5432`
directly (still published, but no longer anyone's front door). `docker
compose up -d --wait` brings up `postgres` → `pgbouncer` → `api` in that
dependency order.

```bash
psql -h 127.0.0.1 -p 6432 -U admin -d ecom -c "SELECT 1"
psql -h 127.0.0.1 -p 6432 -U admin -d pgbouncer -c "SHOW POOLS"
```

**Why `pool_mode = transaction`, and what it costs.** Session pooling (one
client, one server connection, for the client's whole lifetime) doesn't
actually solve the problem PgBouncer exists for — a pool that hands out one
dedicated server connection per client and never takes it back scales the
same way no pooling does. Transaction mode hands a server connection to a
client only for the duration of one transaction, then reclaims it the
instant that transaction ends — which is what actually lets many client
connections (up to `max_client_conn = 100`) share a small, stable number of
real Postgres backends (`default_pool_size = 10`). The cost is real,
specific breakage, not a vague "some things don't work":

- **Named prepared statements** can't be reused — the physical connection a
  statement was prepared on may belong to a completely different client by
  the time the next query comes in. (Verified this doesn't bite this
  project: `pg`'s default query path uses unnamed statements per call, and
  every real DB operation here already runs inside one
  `dataSource.transaction(...)` — re-ran the full `migrate` → `seed` →
  `demo:race` → `demo:workers` → `demo:retry` → `report` sequence against
  the pooled connection and got byte-identical output to running directly
  against Postgres.)
- **Session-level `SET`, `LISTEN`/`NOTIFY`, and session-scoped advisory
  locks** stop working across statements — anything meant to persist state
  on "the connection" between round trips can silently land on a different
  backend than the one that set it up.
- **Temporary tables** are tied to whichever physical backend happened to
  serve that one transaction — a later query in what the app thinks is the
  same session can be handed a different backend that never saw it.

None of this touches this codebase specifically because every operation
here is already scoped to a single transaction or a single one-shot query —
exactly the shape transaction pooling is designed for.

### Backups

`scripts/backup.sh` — `pg_dump -Fc` straight from the `postgres` container
(never through PgBouncer: a dump is one long-lived operation with nothing to
pool, and it would just tie up one of PgBouncer's 10 backend slots for no
benefit). Runs `pg_dump` via `docker compose exec` rather than a
host-installed one, so the dump format always matches the server's own
version instead of whatever happens to be on the machine running cron.

```bash
bash scripts/backup.sh
```

Dumps land in `backups/` (gitignored — real row data, not repo content) as
`ecom_<UTC timestamp>.dump`, custom format, restorable with `pg_restore`.
Each run prunes down to the last 14 dumps.

To schedule it nightly, install `backup.cron` (a fragment, not a full
crontab — see the file for the exact one-liner; it needs the repo's absolute
path filled in):

```bash
crontab -l 2>/dev/null | { cat; sed "s#<repo-path>#$(pwd)#" backup.cron; } | crontab -
```

Requires the `postgres` container to already be up at run time — cron itself
doesn't start the stack.

**Alternative: `pgbackups` sidecar.** A second, opt-in backup mechanism —
same idea (`pg_dump`, direct to `postgres`) but with the schedule living
inside a container instead of the host's crontab, sidestepping host cron's
`PATH`/environment issues with `docker`. Not part of default `docker compose
up`:

```bash
docker compose --profile pgbackups up -d
```

Uses [`prodrigestivill/postgres-backup-local`](https://github.com/prodrigestivill/docker-postgres-backup-local),
same nightly 03:00 schedule, `BACKUP_ON_START=TRUE` so a dump exists
immediately rather than waiting for the first scheduled run. Dumps land in
`./pgbackups/` (gitignored, separate from `backups/` — different dump format,
own retention: 14 daily / 4 weekly / 6 monthly).

### Restore drill

`scripts/restore-drill.sh` proves a backup actually restores, because it's
been restored — not just that a `.dump` file exists. Takes a fresh dump,
`pg_restore`s it into a throwaway, genuinely empty Postgres (own volume, own
port `5434`, no shared state with the real database), checksums `orders`
before and after, and times the restore.

```bash
bash scripts/restore-drill.sh
```

One real executed run, with measured RTO and stated RPO, is documented in
[`RESTORE-DRILL.md`](./RESTORE-DRILL.md).

### WAL archiving & PITR (bonus)

Beyond what HW#15 requires: `postgres` runs with `archive_mode=on` and an
`archive_command` that copies every completed WAL segment into a
`wal_archive` volume, continuously. Combined with a `pg_basebackup`
(base backup) taken at some point T0, this makes **point-in-time recovery**
possible — restoring to any moment between T0 and now, not just to whenever
the last dump happened to run.

```bash
bash scripts/pitr-drill.sh
```

⚠️ **Destructive by design** — the drill truncates real `orders` rows on the
dev `postgres` service on purpose, to have an incident to recover from
(`npm run seed` restores demo data after). Not part of `## Grading` for that
reason — `scripts/restore-drill.sh` already satisfies the graded
requirement on its own.

One real executed run — base backup, a "good" transaction, a simulated
`TRUNCATE`, recovery to the instant before it, checksum MATCH, measured RTO,
RPO = 0 — is documented in [`PITR-DRILL.md`](./PITR-DRILL.md).

## Grading

Fresh clone, clean DB, no vault access:

```bash
docker compose up -d --wait
export DB_URL=postgresql://admin:admin-bootstrap-password@127.0.0.1:6432/ecom
export SKIP_VAULT=1
```

```bash
npm ci
npx tsc --noEmit
npm run build
npm run migrate
npm run migrate:show
npm run migrate:revert
npm run migrate
npm run seed && npm run seed
npm run demo:nplus1
npm run report
npm run demo:race
npm run demo:workers
npm run demo:retry
bash scripts/backup.sh
bash scripts/restore-drill.sh
```
