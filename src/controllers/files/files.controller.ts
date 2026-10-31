import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guards.ts';
import type { AccessTokenClaims } from '../auth/auth.types.ts';
import { CurrentUser } from '../auth/current-user.decorator.ts';

import { CommitUploadDto, CreateUploadIntentDto } from './files.dto.ts';
import { FilesService } from './files.service.ts';

@Controller('uploads')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('intent')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async intent(
    @Body() body: CreateUploadIntentDto,
    @CurrentUser() claims: AccessTokenClaims,
  ) {
    return this.filesService.createIntent(
      claims.sub,
      body.contentType,
      body.size,
    );
  }

  @Post('resume')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async resume(
    @Body() body: CommitUploadDto,
    @CurrentUser() claims: AccessTokenClaims,
  ) {
    return this.filesService.resumeUpload(body.fileUuid, claims.sub);
  }

  @Post('commit')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async commit(
    @Body() body: CommitUploadDto,
    @CurrentUser() claims: AccessTokenClaims,
  ) {
    return this.filesService.commit(body.fileUuid, claims.sub);
  }
}
