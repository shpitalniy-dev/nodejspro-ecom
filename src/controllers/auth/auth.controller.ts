import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';

import { ConcurrencyLimitExceededError } from '../../services/concurrency-limiter.ts';

import { LoginDto } from './auth.dto.ts';
import { AuthGuard, LoginRateLimitGuard } from './auth.guards.ts';
import { AuthService } from './auth.service.ts';
import type { AccessTokenClaims } from './auth.types.ts';
import { CurrentUser } from './current-user.decorator.ts';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @UseGuards(LoginRateLimitGuard)
  async login(@Body() body: LoginDto) {
    try {
      const { token, expiresIn } = await this.authService.login(
        body.email,
        body.password,
      );

      return { accessToken: token, expiresIn };
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

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@CurrentUser() user: AccessTokenClaims) {
    return this.authService.getCurrentUser(user);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logout(@CurrentUser() user: AccessTokenClaims): Promise<void> {
    await this.authService.logout(user);
  }
}
