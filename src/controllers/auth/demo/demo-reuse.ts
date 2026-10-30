import 'reflect-metadata';

import { sleep } from '../../../utils/sleep.ts';
import { GRACE_WINDOW_MS } from '../refresh-token.service.ts';

import {
  DEMO_BUYER_EMAIL,
  DEMO_BUYER_PASSWORD,
  extractCookie,
  postLogin,
  startDemoApp,
} from './demo.utils.ts';

// demo:reuse — the homework's ⭐⭐ requirement: a replayed refresh token
// doesn't just fail itself, it kills the whole family, including whatever
// the legitimate rotation issued one step ahead.

// Deliberately wait past the grace window before replaying R1 — fired
// milliseconds after the real rotation, this would land inside the window
// and get treated as a client-side race (same pair handed back, 200), not
// the reuse it's meant to simulate. A stolen token "arriving second" is
// the scenario; the lecture's own demo frames it exactly this way.
const REPLAY_DELAY_MS = GRACE_WINDOW_MS + 500;

async function main(): Promise<void> {
  const { baseUrl, close } = await startDemoApp();

  try {
    const login = await postLogin(
      baseUrl,
      DEMO_BUYER_EMAIL,
      DEMO_BUYER_PASSWORD,
    );

    await login.json(); // drain the body; accessToken isn't needed here
    const r1Cookie = extractCookie(login);

    // R1 → R2: the legitimate rotation.
    const r1Refresh = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: r1Cookie },
    });
    const r2Cookie = r1Refresh.ok ? extractCookie(r1Refresh) : null;

    await sleep(REPLAY_DELAY_MS);

    // The stolen token "arrives second" — replaying R1 after it's already
    // been rotated, and well past the grace window.
    const r1Reuse = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: r1Cookie },
    });

    // R2 was only ever handed to the legitimate client via r1Refresh
    // above — if the reuse detection above correctly revoked the whole
    // family, this must also be dead, not just R1.
    const r2AfterReuse = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: r2Cookie ?? r1Cookie },
    });

    console.log('demo:reuse — a replayed refresh token kills its whole family');
    console.log(`login=${login.status}`);
    console.log(`r1-refresh=${r1Refresh.status}`);
    console.log(`r1-reuse=${r1Reuse.status}`);
    console.log(`r2-after-reuse=${r2AfterReuse.status}`);

    const invariantOk =
      login.status === 200 &&
      r1Refresh.status === 200 &&
      r1Reuse.status === 401 &&
      r2AfterReuse.status === 401;

    if (invariantOk) {
      console.log(
        'invariant check passed — replaying R1 revoked the whole family, not just R1 itself',
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
