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
