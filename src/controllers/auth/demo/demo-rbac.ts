import 'reflect-metadata';

import { Order } from '../../../entities/order.entity.ts';
import { User } from '../../../entities/user.entity.ts';
import { DataSourceService } from '../../../services/data-source.service.ts';

import {
  DEMO_ADMIN_EMAIL,
  DEMO_ADMIN_PASSWORD,
  DEMO_BUYER_EMAIL,
  DEMO_BUYER_PASSWORD,
  type LoginResponse,
  postLogin,
  startDemoApp,
} from './demo.utils.ts';

// demo:rbac — HW #24 slice 3: plain NestJS guards (RolesGuard, the fixed
// OrderOwnershipGuard), no Zanzibar/ReBAC — see README's Authorization
// section for why that was the right call here. Six checks, matching the
// homework's own contract: anon, own, foreign, role-denied, role-allowed,
// tampered.
//
// POST /orders still attributes every order to the storefront placeholder
// (deliberately out of scope this slice — see README), so this seeds an
// order directly via the app's own DataSourceService, the same minimal
// shape the test builders use, rather than creating one through the live
// endpoint.

// Same token, corrupted signature — the last character of the signature
// segment is flipped to a fixed, always-different value. Proves
// verification actually checks the signature, not just that a header and
// payload exist.
function tamper(token: string): string {
  const [header, payload, signature] = token.split('.');
  const lastChar = signature.at(-1);
  const flippedChar = lastChar === 'A' ? 'B' : 'A';

  return `${header}.${payload}.${signature.slice(0, -1)}${flippedChar}`;
}

async function accessTokenFor(
  baseUrl: string,
  email: string,
  password: string,
): Promise<string> {
  const res = await postLogin(baseUrl, email, password);

  if (!res.ok) {
    throw new Error(`login(${email}) -> ${res.status}`);
  }

  const { accessToken } = (await res.json()) as LoginResponse;

  return accessToken;
}

async function main(): Promise<void> {
  const { baseUrl, app, close } = await startDemoApp();

  try {
    const manager = await app.get(DataSourceService).getManager();
    const buyer = await manager
      .getRepository(User)
      .findOneByOrFail({ email: DEMO_BUYER_EMAIL });

    const order = await manager.getRepository(Order).save({
      currency: 'USD',
      amountCents: '1999',
      user: { id: buyer.id },
    });

    const [product] = (
      await fetch(`${baseUrl}/products?limit=1`).then(
        res => res.json() as Promise<{ items: Array<{ id: number }> }>,
      )
    ).items;

    if (!product) {
      throw new Error('no products found — run `npm run seed` first');
    }

    const buyerToken = await accessTokenFor(
      baseUrl,
      DEMO_BUYER_EMAIL,
      DEMO_BUYER_PASSWORD,
    );
    const adminToken = await accessTokenFor(
      baseUrl,
      DEMO_ADMIN_EMAIL,
      DEMO_ADMIN_PASSWORD,
    );

    // anon: no token at all on an authenticated route.
    const anon = await fetch(`${baseUrl}/orders/${order.id}`);

    // own: the buyer reads the order she actually owns.
    const own = await fetch(`${baseUrl}/orders/${order.id}`, {
      headers: { authorization: `Bearer ${buyerToken}` },
    });

    // foreign: a different, equally-valid identity — not the owner, and
    // ownership is enforced the same regardless of role (no admin bypass).
    const foreign = await fetch(`${baseUrl}/orders/${order.id}`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });

    // role-denied / role-allowed: same endpoint, same body, only the
    // caller's role differs.
    const newPriceCents = 7777;
    const updateBody = JSON.stringify({ price_cents: newPriceCents });

    const roleDenied = await fetch(`${baseUrl}/products/${product.id}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${buyerToken}`,
        'content-type': 'application/json',
      },
      body: updateBody,
    });
    const roleAllowed = await fetch(`${baseUrl}/products/${product.id}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      body: updateBody,
    });

    // tampered: a structurally valid token whose signature no longer
    // matches — must fail verification regardless of the (unchanged)
    // claims it carries.
    const tampered = await fetch(`${baseUrl}/orders/${order.id}`, {
      headers: { authorization: `Bearer ${tamper(buyerToken)}` },
    });

    const confirmed = (await fetch(`${baseUrl}/products/${product.id}`).then(
      res => res.json(),
    )) as { price_cents: number };

    console.log('demo:rbac — order ownership + admin-only product update');
    console.log(`anon=${anon.status}`);
    console.log(`own=${own.status}`);
    console.log(`foreign=${foreign.status}`);
    console.log(`role-denied=${roleDenied.status}`);
    console.log(`role-allowed=${roleAllowed.status}`);
    console.log(`tampered=${tampered.status}`);

    const invariantOk =
      anon.status === 401 &&
      own.status === 200 &&
      foreign.status === 403 &&
      roleDenied.status === 403 &&
      roleAllowed.status === 200 &&
      tampered.status === 401 &&
      confirmed.price_cents === newPriceCents;

    if (invariantOk) {
      console.log(
        'invariant check passed — ownership, role, and signature checks all hold, and the admin update actually took effect',
      );
    } else {
      console.error('invariant check FAILED');
      process.exitCode = 1;
    }
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
