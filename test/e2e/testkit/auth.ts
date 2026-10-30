import type { INestApplication } from '@nestjs/common';

import { AccessTokenService } from '../../../src/controllers/auth/access-token.service.ts';

// Mints a real, verifiable access token straight from the app's own DI
// container — same signing path AuthService.login() uses, just skipping
// the HTTP round trip and argon2id cost a real /auth/login would add for
// every order test that just needs *some* authenticated caller.
export function issueAccessToken(
  app: INestApplication,
  user: { uuid: string; role: string },
): string {
  return app.get(AccessTokenService).issue(user).token;
}
