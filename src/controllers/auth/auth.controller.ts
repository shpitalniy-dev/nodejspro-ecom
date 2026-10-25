import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { CookieOptions, Response } from 'express';

import { ConcurrencyLimitExceededError } from '../../services/concurrency-limiter.ts';

import { LoginDto } from './auth.dto.ts';
import { AuthGuard, LoginRateLimitGuard } from './auth.guards.ts';
import { AuthService } from './auth.service.ts';
import type { AccessTokenClaims, LoginResult } from './auth.types.ts';
import { CurrentUser } from './current-user.decorator.ts';
import {
  REFRESH_COOKIE_NAME,
  RefreshCookie,
} from './refresh-cookie.decorator.ts';
import { IDLE_TTL_SECONDS } from './refresh-token.service.ts';

// __Host- is browser-enforced, not just a naming convention: a cookie with
// this prefix is only accepted at all if it also has Secure, Path=/, and
// no Domain attribute — which is exactly what closes off a sibling
// subdomain setting or overriding it.
const REFRESH_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
};

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @UseGuards(LoginRateLimitGuard)
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const result = await this.authService.login(body.email, body.password);

      this.setRefreshCookie(res, result.refreshToken);

      return { accessToken: result.token, expiresIn: result.expiresIn };
    } catch (error) {
      if (error instanceof ConcurrencyLimitExceededError) {
        throw new HttpException(
          {
            title: 'Too many requests',
            detail: 'Too many login attempts in flight, try again shortly.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      throw error;
    }
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @RefreshCookie() token: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!token) {
      throw new UnauthorizedException({
        title: 'Unauthorized',
        detail: 'Missing refresh token.',
      });
    }

    let result: LoginResult;

    try {
      result = await this.authService.refresh(token);
    } catch (error) {
      res.clearCookie(REFRESH_COOKIE_NAME, REFRESH_COOKIE_OPTIONS);
      throw error;
    }

    this.setRefreshCookie(res, result.refreshToken);

    return { accessToken: result.token, expiresIn: result.expiresIn };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@CurrentUser() user: AccessTokenClaims) {
    return this.authService.getCurrentUser(user);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logout(
    @CurrentUser() user: AccessTokenClaims,
    @RefreshCookie() token: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logout(user, token);
    res.clearCookie(REFRESH_COOKIE_NAME, REFRESH_COOKIE_OPTIONS);
  }

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE_NAME, token, {
      ...REFRESH_COOKIE_OPTIONS,
      maxAge: IDLE_TTL_SECONDS * 1000,
    });
  }
}
