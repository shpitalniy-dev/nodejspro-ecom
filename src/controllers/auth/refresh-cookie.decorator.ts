import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';

export const REFRESH_COOKIE_NAME = '__Host-rt';

// Same shape as current-user.decorator.ts's @CurrentUser() — keeps the
// Express Request type, and cookie-parser's untyped req.cookies, out of
// the controller's own method signatures.
export const RefreshCookie = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined => {
    const req = context.switchToHttp().getRequest<Request>();
    const cookies = req.cookies as Record<string, string | undefined>;

    return cookies[REFRESH_COOKIE_NAME];
  },
);
