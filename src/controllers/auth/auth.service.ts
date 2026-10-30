import { Injectable, UnauthorizedException } from '@nestjs/common';

import { User } from '../../entities/user.entity.ts';
import { DataSourceService } from '../../services/data-source.service.ts';

import { AccessDenylistService } from './access-denylist.service.ts';
import { AccessTokenService } from './access-token.service.ts';
import type { AccessTokenClaims, LoginResult } from './auth.types.ts';
import { PasswordService } from './password.service.ts';
import { RefreshTokenService } from './refresh-token.service.ts';

@Injectable()
export class AuthService {
  constructor(
    private readonly dataSourceService: DataSourceService,
    private readonly passwordService: PasswordService,
    private readonly accessTokenService: AccessTokenService,
    private readonly accessDenylistService: AccessDenylistService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const manager = await this.dataSourceService.getManager();
    const user = await manager
      .getRepository(User)
      .findOne({ where: { email } });

    if (!user?.passwordHash) {
      throw this.invalidCredentials();
    }

    const passwordOk = await this.passwordService.verify(
      user.passwordHash,
      password,
    );

    if (!passwordOk) {
      throw this.invalidCredentials();
    }

    const issued = this.accessTokenService.issue({
      uuid: user.uuid,
      role: user.role,
    });
    const refresh = await this.refreshTokenService.issueFamily(user.id);

    return {
      ...issued,
      expiresIn: issued.exp - Math.floor(Date.now() / 1000),
      refreshToken: refresh.token,
    };
  }

  // refreshToken is optional
  async logout(
    claims: AccessTokenClaims,
    refreshToken?: string,
  ): Promise<void> {
    const ttlSeconds = claims.exp - Math.floor(Date.now() / 1000);

    await this.accessDenylistService.deny(claims.iss, claims.jti, ttlSeconds);

    if (refreshToken) {
      await this.refreshTokenService.revokeFamilyForToken(refreshToken);
    }
  }

  async refresh(refreshToken: string): Promise<LoginResult> {
    const result = await this.refreshTokenService.rotate(refreshToken);

    if (result.status !== 'ok') {
      throw this.invalidRefreshToken();
    }

    const manager = await this.dataSourceService.getManager();
    const user = await manager
      .getRepository(User)
      .findOne({ where: { id: result.result.userId } });

    if (!user) {
      throw this.invalidRefreshToken();
    }

    const issued = this.accessTokenService.issue({
      uuid: user.uuid,
      role: user.role,
    });

    return {
      ...issued,
      expiresIn: issued.exp - Math.floor(Date.now() / 1000),
      refreshToken: result.result.refreshToken,
    };
  }

  async getCurrentUser(
    claims: AccessTokenClaims,
  ): Promise<{ id: number; email: string; role: string }> {
    const manager = await this.dataSourceService.getManager();
    const user = await manager
      .getRepository(User)
      .findOne({ where: { uuid: claims.sub } });

    if (!user) {
      throw new UnauthorizedException({
        title: 'Unauthorized',
        detail: 'Account no longer exists.',
      });
    }

    return { id: user.id, email: user.email, role: user.role };
  }

  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException({
      title: 'Invalid credentials',
      detail: 'Email or password is incorrect.',
    });
  }

  private invalidRefreshToken(): UnauthorizedException {
    return new UnauthorizedException({
      title: 'Unauthorized',
      detail: 'Refresh token is invalid, expired, or already used.',
    });
  }
}
