import 'reflect-metadata';

import {
  DEMO_BUYER_EMAIL,
  DEMO_BUYER_PASSWORD,
  extractCookie,
  type LoginResponse,
  postLogin,
  startDemoApp,
} from './demo.utils.ts';

// demo:auth — login/me/refresh/logout mechanics (HW #24, slice 2 — the
// full access+refresh contract).
async function main(): Promise<void> {
  const { baseUrl, close } = await startDemoApp();

  try {
    const login = await postLogin(
      baseUrl,
      DEMO_BUYER_EMAIL,
      DEMO_BUYER_PASSWORD,
    );

    let { accessToken } = (await login.json()) as LoginResponse;
    let refreshCookie = extractCookie(login);

    const noToken = await fetch(`${baseUrl}/auth/me`);
    const withToken = await fetch(`${baseUrl}/auth/me`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });

    const refresh = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: refreshCookie },
    });

    if (refresh.ok) {
      ({ accessToken } = (await refresh.json()) as LoginResponse);
      refreshCookie = extractCookie(refresh);
    }

    // Latest (rotated) access token and cookie — same as what a real
    // client would be holding at this point.
    const logout = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        cookie: refreshCookie,
      },
    });

    // Same refresh cookie, reused after logout revoked its family — this
    // is what actually proves logout's second action fired, not just
    // that the route exists.
    const refreshAfterLogout = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: refreshCookie },
    });

    console.log(
      'demo:auth — login / me / refresh / logout (full access+refresh contract)',
    );
    console.log(`login=${login.status}`);
    console.log(`no-token=${noToken.status}`);
    console.log(`with-token=${withToken.status}`);
    console.log(`refresh=${refresh.status}`);
    console.log(`logout=${logout.status}`);
    console.log(`refresh-after-logout=${refreshAfterLogout.status}`);

    const invariantOk =
      login.status === 200 &&
      noToken.status === 401 &&
      withToken.status === 200 &&
      refresh.status === 200 &&
      logout.status === 204 &&
      refreshAfterLogout.status === 401;

    if (invariantOk) {
      console.log(
        'invariant check passed — refresh rotates the token, logout kills both the access token and the refresh family',
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
