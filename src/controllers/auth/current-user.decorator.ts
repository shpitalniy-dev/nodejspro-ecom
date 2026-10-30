import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';

import type { AccessTokenClaims } from './auth.types.ts';

// Only meaningful behind @UseGuards(AuthGuard), which is what actually
// populates request.user — this decorator just reads it back out.
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AccessTokenClaims => {
    const req = context.switchToHttp().getRequest<Request>();

    return req.user as AccessTokenClaims;
  },
);
