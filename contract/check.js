import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

const getIdempotencyKey = () => `check-${Date.now()}`;
const sameIdempotencyKey = getIdempotencyKey();
const sameCreateOrderBody = { items: [{ productId: 1, quantity: 1 }] };

const CHECKS = [
  {
    name: 'GET /products returns 200',
    req: { method: 'GET', url: '/products' },
    expect: { path: '/products', method: 'get', status: 200 },
  },
  {
    name: 'GET /products/1 returns 200',
    req: { method: 'GET', url: '/products/1' },
    expect: { path: '/products/{productId}', method: 'get', status: 200 },
  },
  {
    name: 'GET /products/999999 returns 404',
    req: { method: 'GET', url: '/products/999999' },
    expect: { path: '/products/{productId}', method: 'get', status: 404 },
  },
  {
    name: 'GET /products/not-a-number returns 400',
    req: { method: 'GET', url: '/products/not-a-number' },
    expect: { path: '/products/{productId}', method: 'get', status: 400 },
  },
  {
    name: 'GET /orders returns 200',
    req: { method: 'GET', url: '/orders' },
    expect: { path: '/orders', method: 'get', status: 200 },
  },
  {
    name: 'GET /orders/999999 returns 404',
    req: { method: 'GET', url: '/orders/999999' },
    expect: { path: '/orders/{orderId}', method: 'get', status: 404 },
  },
  {
    name: 'GET /orders/not-a-number returns 400',
    req: { method: 'GET', url: '/orders/not-a-number' },
    expect: { path: '/orders/{orderId}', method: 'get', status: 400 },
  },
  {
    name: 'POST /orders with Idempotency-Key returns 201',
    req: {
      method: 'POST',
      url: '/orders',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': sameIdempotencyKey,
      },
      body: JSON.stringify(sameCreateOrderBody),
    },
    expect: { path: '/orders', method: 'post', status: 201 },
  },
  {
    name: 'POST /orders with same Idempotency-Key and same body returns 201',
    req: {
      method: 'POST',
      url: '/orders',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': sameIdempotencyKey,
      },
      body: JSON.stringify(sameCreateOrderBody),
    },
    expect: { path: '/orders', method: 'post', status: 201 },
  },
  {
    name: 'POST /orders with same Idempotency-Key and different body returns 422',
    req: {
      method: 'POST',
      url: '/orders',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': sameIdempotencyKey,
      },
      body: JSON.stringify({ items: [{ productId: 1, quantity: 2 }] }),
    },
    expect: { path: '/orders', method: 'post', status: 422 },
  },
  {
    name: 'POST /orders without Idempotency-Key returns 400',
    req: {
      method: 'POST',
      url: '/orders',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(sameCreateOrderBody),
    },
    expect: {
      path: '/orders',
      method: 'post',
      status: 400,
      partialBody: {
        detail: "request/headers must have required property 'idempotency-key'",
      },
    },
  },
  {
    name: 'POST /orders with empty items returns 400',
    req: {
      method: 'POST',
      url: '/orders',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': getIdempotencyKey(),
      },
      body: JSON.stringify({ items: [] }),
    },
    expect: {
      path: '/orders',
      method: 'post',
      status: 400,
      partialBody: {
        detail: 'request/body/items must NOT have fewer than 1 items',
      },
    },
  },
  {
    name: 'POST /orders with unexpected body properties returns 400',
    req: {
      method: 'POST',
      url: '/orders',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': getIdempotencyKey(),
      },
      body: JSON.stringify({
        items: [{ productId: 1, quantity: 2 }],
        unexpected: 'property',
      }),
    },
    expect: {
      path: '/orders',
      method: 'post',
      status: 400,
      partialBody: {
        detail: 'request/body must NOT have additional properties',
      },
    },
  },
];

const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true });
addFormats(ajv);

function deref(node, spec, seen = new Set()) {
  if (Array.isArray(node)) return node.map(n => deref(n, spec, seen));
  if (node === null || typeof node !== 'object') return node;

  if (typeof node.$ref === 'string') {
    if (seen.has(node.$ref)) throw new Error(`циклічний $ref: ${node.$ref}`);
    const target = node.$ref
      .replace(/^#\//, '')
      .split('/')
      .reduce((acc, part) => acc?.[part], spec);
    if (!target) throw new Error(`$ref не знайдено: ${node.$ref}`);

    return deref(target, spec, new Set([...seen, node.$ref]));
  }

  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = deref(v, spec, seen);

  if (out.nullable === true && typeof out.type === 'string') {
    out.type = [out.type, 'null'];
    delete out.nullable;
  }

  return out;
}

const specPath = path.join(process.cwd(), 'openapi/openapi.yaml');
const spec = parse(readFileSync(specPath, 'utf8'));
console.log(
  `Contract: ${spec.info.title} ${spec.info.version} (openapi ${spec.openapi})`,
);
console.log(`Server:   ${BASE}\n`);

let failed = 0;

for (const check of CHECKS) {
  const { path: opPath, method, status } = check.expect;
  const declared = spec.paths?.[opPath]?.[method]?.responses?.[String(status)];

  if (!declared) {
    console.log(
      `✗ ${check.name}\n    not declared in spec: ${method.toUpperCase()} ${opPath} → ${status}`,
    );
    failed++;
    continue;
  }

  const res = await fetch(`${BASE}${check.req.url}`, {
    method: check.req.method,
    headers: check.req.headers,
    body: check.req.body,
  });

  const problems = [];

  if (res.status !== status)
    problems.push(`status: expected ${status}, got ${res.status}`);

  const contentTypes = Object.keys(declared.content ?? {});
  const actualType = (res.headers.get('content-type') ?? '')
    .split(';')[0]
    .trim();

  if (contentTypes.length && !contentTypes.includes(actualType)) {
    problems.push(
      `content-type: expected [${contentTypes}], got "${actualType}"`,
    );
  }

  for (const [headerName, headerSchema] of Object.entries(
    declared.headers ?? {},
  )) {
    if (headerSchema.required && !res.headers.get(headerName)) {
      problems.push(`header "${headerName}" declared as required, but missing`);
    }
  }

  const schema = declared.content?.[contentTypes[0]]?.schema;

  if (schema) {
    const body = await res.json();
    const validate = ajv.compile(deref(schema, spec));

    if (!validate(body)) {
      for (const err of validate.errors ?? []) {
        problems.push(`schema: body${err.instancePath} ${err.message}`);
      }
    }

    const expectedBodyFields = check.expect.partialBody;

    for (const key in expectedBodyFields) {
      if (expectedBodyFields[key] !== body[key]) {
        problems.push(
          `body: expected property "${key}" to be ${JSON.stringify(expectedBodyFields[key])}, got ${JSON.stringify(body[key])}`,
        );
      }
    }
  }

  if (problems.length) {
    failed++;
    console.log(`✗ ${check.name}`);
    for (const p of problems) console.log(`    ${p}`);
  } else {
    console.log(`✓ ${check.name}`);
  }
}

console.log(
  failed === 0
    ? `\nCONTRACT COMPLIANT: ${CHECKS.length}/${CHECKS.length} checks passed`
    : `\nCONTRACT VIOLATED: ${failed} of ${CHECKS.length} checks failed`,
);

process.exit(failed === 0 ? 0 : 1);
